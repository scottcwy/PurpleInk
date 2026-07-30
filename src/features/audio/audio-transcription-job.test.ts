import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'
import type { AudioProjectSourcePayload } from '@/features/projects'
import type { StorageAdapter } from '@/lib/storage'
import {
  runAudioTranscriptionJob,
  type AudioTranscriptionDependencies,
} from './audio-transcription-job'
import { persistUserAudioArtifacts } from './user-audio-artifacts'
import { sliceDecodedUserRecording } from './user-audio-slicer'
import { buildUserAudioTimeline } from './user-audio-timeline'

vi.mock('server-only', () => ({}))

const SOURCE_BYTES = Buffer.from('真实录音源字节')
const SOURCE_HASH = sha256(SOURCE_BYTES)
const SAMPLE_RATE = 8_000
const SAMPLE_COUNT = 160_000

function audioSource(
  overrides: Partial<AudioProjectSourcePayload> = {},
): AudioProjectSourcePayload {
  return {
    schemaVersion: 1,
    kind: 'audio',
    storageKey: 'project-sources/workspace/project/source.mp3',
    fileName: '用户录音.mp3',
    mimeType: 'audio/mpeg',
    container: 'mp3',
    sizeBytes: SOURCE_BYTES.length,
    durationMs: 20_000,
    sampleRate: SAMPLE_RATE,
    sampleCount: SAMPLE_COUNT,
    visualTheme: 'dark',
    ...overrides,
  }
}

function speech() {
  return {
    transcript: '第一段。第二段。',
    model: 'step-asr',
    alignmentSource: 'stepfun-asr' as const,
    captions: [
      { startMs: 0, endMs: 9_000, text: '第一段。' },
      { startMs: 10_000, endMs: 20_000, text: '第二段。' },
    ],
  }
}

function dependencies(): AudioTranscriptionDependencies {
  return {
    loadSource: vi.fn(async () => ({
      source: audioSource(),
      sourceFingerprint: SOURCE_HASH,
    })),
    readSourceBytes: vi.fn(async () => SOURCE_BYTES),
    decode: vi.fn<AudioTranscriptionDependencies['decode']>(async () => ({
      measured: {
        sampleRateHz: SAMPLE_RATE,
        sampleCount: SAMPLE_COUNT,
        durationMs: 20_000,
        container: 'mp3' as const,
      },
      pcmBytes: Buffer.alloc(SAMPLE_COUNT * 2),
    })),
    transcribe: vi.fn(async () => speech()),
    persistArtifacts: vi.fn<AudioTranscriptionDependencies['persistArtifacts']>(
      async (input) => ({
      sourceArtifactId: 'source-artifact',
      cutArtifactIds: input.slices.map((_, index) => `cut-${index + 1}`),
      ingestArtifactId: 'ingest-artifact',
      ingestAudioArtifactId: 'audio-artifact',
      ingestContentHash: 'a'.repeat(64),
      audioContentHash: 'b'.repeat(64),
      audioManifest: {
        version: 1,
        engine: 'user-recording-asr',
        units: [],
        totalMs: 20_000,
      },
      audioAllocation: {
        schemaVersion: 1,
        inputDigests: {
          audioManifest: `sha256:${'a'.repeat(64)}`,
          runtimeBindings: `sha256:${'b'.repeat(64)}`,
          scriptUnits: `sha256:${'c'.repeat(64)}`,
        },
        fps: 30,
        shots: [],
        totalFrames: 600,
      },
      }),
    ),
    updateProjectScript: vi.fn(async () => {}),
    materialize: vi.fn(async () => {}),
    transition: vi.fn(async () => {}),
    recordState: vi.fn(async () => {}),
    advance: vi.fn(async () => {}),
    now: () => new Date('2026-07-30T01:00:00.000Z'),
  }
}

const JOB = {
  projectId: 'project-1',
  nodeId: 'audio-node-1',
  billingContext: { attemptId: 'attempt-1', invocationNo: 30_001 },
}

describe('runAudioTranscriptionJob', () => {
  it('uses measured ASR timing, original PCM cuts, and never requests TTS', async () => {
    const deps = dependencies()
    const synthesizeTts = vi.fn()
    const withForbiddenTts = {
      ...deps,
      synthesizeTts,
    } as AudioTranscriptionDependencies & { synthesizeTts: typeof synthesizeTts }

    await runAudioTranscriptionJob(JOB, withForbiddenTts)

    expect(deps.transcribe).toHaveBeenCalledWith({
      audioBytes: SOURCE_BYTES,
      audioFormat: 'mp3',
      audioSeconds: 20,
      billingContext: JOB.billingContext,
    })
    expect(deps.persistArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: JOB.projectId,
        nodeId: JOB.nodeId,
        attemptId: JOB.billingContext.attemptId,
        sourceBytes: SOURCE_BYTES,
        slices: [
          expect.objectContaining({ unitId: 'U001', durationMs: 9_500 }),
          expect.objectContaining({ unitId: 'U002', durationMs: 10_500 }),
        ],
      }),
    )
    expect(deps.updateProjectScript).toHaveBeenCalledWith(
      JOB.projectId,
      '第一段。第二段。',
    )
    expect(deps.materialize).toHaveBeenCalledWith(JOB.projectId, [
      {
        shotId: 'S001',
        sourceUnit: { unitId: 'U001', text: '第一段。', order: 0 },
      },
      {
        shotId: 'S002',
        sourceUnit: { unitId: 'U002', text: '第二段。', order: 1 },
      },
    ])
    expect(deps.transition).toHaveBeenNthCalledWith(1, JOB.nodeId, 'running')
    expect(deps.transition).toHaveBeenNthCalledWith(2, JOB.nodeId, 'success')
    expect(deps.recordState).toHaveBeenLastCalledWith(
      JOB.nodeId,
      expect.objectContaining({
        status: 'ready',
        unitCount: 2,
        alignmentMode: 'caption-timestamps',
      }),
      'a'.repeat(64),
    )
    expect(deps.advance).toHaveBeenCalledWith(JOB.projectId)
    expect(synthesizeTts).not.toHaveBeenCalled()
  })

  it('rejects source hash drift before decoding or calling ASR', async () => {
    const deps = dependencies()
    vi.mocked(deps.loadSource).mockResolvedValueOnce({
      source: audioSource(),
      sourceFingerprint: 'f'.repeat(64),
    })

    await expect(runAudioTranscriptionJob(JOB, deps)).rejects.toThrow(
      '录音源文件与创建项目时登记的字节证据不一致',
    )

    expect(deps.decode).not.toHaveBeenCalled()
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.persistArtifacts).not.toHaveBeenCalled()
    expect(deps.transition).toHaveBeenNthCalledWith(2, JOB.nodeId, 'failed')
    expect(deps.recordState).toHaveBeenLastCalledWith(
      JOB.nodeId,
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          stage: 'INGEST',
          sourceNodeId: JOB.nodeId,
        }),
      }),
    )
  })

  it('rejects decoded metadata drift before calling ASR', async () => {
    const deps = dependencies()
    vi.mocked(deps.decode).mockResolvedValueOnce({
      measured: {
        sampleRateHz: 16_000,
        sampleCount: SAMPLE_COUNT,
        durationMs: 10_000,
        container: 'mp3',
      },
      pcmBytes: Buffer.alloc(SAMPLE_COUNT * 2),
    })

    await expect(runAudioTranscriptionJob(JOB, deps)).rejects.toThrow(
      '录音源文件的实测媒体元数据与项目来源记录不一致',
    )

    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.persistArtifacts).not.toHaveBeenCalled()
    expect(deps.transition).toHaveBeenNthCalledWith(2, JOB.nodeId, 'failed')
  })

  it('stores a safe provider projection and leaves no downstream work on ASR failure', async () => {
    const deps = dependencies()
    vi.mocked(deps.transcribe).mockRejectedValueOnce(
      new Error('StepFun ASR HTTP 503 raw provider body'),
    )

    await expect(runAudioTranscriptionJob(JOB, deps)).rejects.toThrow(
      'StepFun ASR HTTP 503',
    )

    const failure = vi.mocked(deps.recordState).mock.calls.at(-1)?.[1]
    expect(failure).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'PROVIDER_FAILED',
          message: '外部生成服务本次执行失败，可以稍后重试。',
          retryable: true,
        }),
      }),
    )
    expect(JSON.stringify(failure)).not.toContain('raw provider body')
    expect(deps.persistArtifacts).not.toHaveBeenCalled()
    expect(deps.updateProjectScript).not.toHaveBeenCalled()
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.advance).not.toHaveBeenCalled()
  })

  it('projects Provider pacing as waiting without persisting dispatch internals', async () => {
    const deps = dependencies()
    const retryAt = new Date('2026-07-30T01:00:00.450Z')
    const waitError = new ProviderQueueDeferral({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      retryAt,
      scopeKey: 'a'.repeat(64),
      waitReason: 'pacing',
    })
    vi.mocked(deps.transcribe).mockRejectedValueOnce(waitError)

    await expect(runAudioTranscriptionJob(JOB, deps)).rejects.toBe(waitError)

    expect(vi.mocked(deps.recordState).mock.calls.at(-1)).toEqual([
      JOB.nodeId,
      {
        status: 'waiting',
        code: 'PROVIDER_POOL_WAIT',
        message: '阶跃星辰正在等待可用调用窗口',
        resumeAt: retryAt.toISOString(),
        providerLabel: '阶跃星辰',
      },
    ])
    expect(deps.transition).toHaveBeenCalledTimes(1)
    expect(deps.transition).toHaveBeenCalledWith(JOB.nodeId, 'running')
    expect(deps.persistArtifacts).not.toHaveBeenCalled()
    expect(deps.updateProjectScript).not.toHaveBeenCalled()
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.advance).not.toHaveBeenCalled()
  })

  it('rejects an empty ASR transcript before writing project state or artifacts', async () => {
    const deps = dependencies()
    vi.mocked(deps.transcribe).mockResolvedValueOnce({
      ...speech(),
      transcript: '   ',
      captions: [],
    })

    await expect(runAudioTranscriptionJob(JOB, deps)).rejects.toThrow()

    expect(deps.persistArtifacts).not.toHaveBeenCalled()
    expect(deps.updateProjectScript).not.toHaveBeenCalled()
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.transition).toHaveBeenNthCalledWith(2, JOB.nodeId, 'failed')
  })
})

describe('persistUserAudioArtifacts', () => {
  it('registers final source, WAV cuts, and both Director contracts from actual bytes', async () => {
    const memory = new Map<string, Buffer>()
    const pointers: Array<{
      kind: string
      storageKey: string
      contentHash: string
    }> = []
    const storage = memoryStorage(memory)
    const decoded = {
      measured: {
        sampleRateHz: SAMPLE_RATE,
        sampleCount: SAMPLE_COUNT,
        durationMs: 20_000,
        container: 'mp3' as const,
      },
      pcmBytes: Buffer.alloc(SAMPLE_COUNT * 2, 7),
    }
    const timeline = buildUserAudioTimeline({
      transcript: speech().transcript,
      captions: speech().captions,
      measured: decoded.measured,
    })
    const slices = sliceDecodedUserRecording(decoded, timeline)

    const result = await persistUserAudioArtifacts(
      {
        projectId: 'project-1',
        nodeId: 'audio-node-1',
        attemptId: 'attempt-secret',
        source: audioSource(),
        sourceContentHash: SOURCE_HASH,
        sourceBytes: SOURCE_BYTES,
        timeline,
        slices,
      },
      {
        storage,
        writer: {
          registerPointer: vi.fn(async (pointer) => {
            const bytes = memory.get(pointer.storageKey)
            expect(bytes).toBeDefined()
            expect(sha256(bytes!)).toBe(pointer.contentHash)
            pointers.push({
              kind: pointer.kind,
              storageKey: pointer.storageKey,
              contentHash: pointer.contentHash!,
            })
            return `artifact-${pointers.length}`
          }),
        },
      },
    )

    expect(pointers.map(({ kind }) => kind)).toEqual([
      'user-audio-source',
      'user-audio-cut',
      'narration-audio:U001',
      'user-audio-cut',
      'narration-audio:U002',
      'director-ingest',
      'director-ingest-audio',
    ])
    expect(pointers.every(({ storageKey }) => !storageKey.includes('attempt-secret')))
      .toBe(true)
    expect(result.audioManifest).toEqual(
      expect.objectContaining({
        engine: 'user-recording-asr',
        sourceAudioSha256: `sha256:${SOURCE_HASH}`,
        units: [
          expect.objectContaining({ unitId: 'U001', source: 'user' }),
          expect.objectContaining({ unitId: 'U002', source: 'user' }),
        ],
      }),
    )
    expect(result.audioManifest).not.toHaveProperty('voice')
    expect(result.audioAllocation.shots).toEqual([
      expect.objectContaining({ id: 'S001', durationInFrames: 285 }),
      expect.objectContaining({ id: 'S002', durationInFrames: 315 }),
    ])
    const cutPointers = pointers.filter(({ kind }) => kind === 'user-audio-cut')
    for (const pointer of cutPointers) {
      expect(memory.get(pointer.storageKey)?.subarray(0, 4).toString('ascii')).toBe(
        'RIFF',
      )
    }
    for (const unit of ['U001', 'U002']) {
      const narration = pointers.find(
        ({ kind }) => kind === `narration-audio:${unit}`,
      )
      const cut = pointers.find(
        ({ kind, storageKey }) =>
          kind === 'user-audio-cut' && storageKey.includes(`/${unit}-`),
      )
      expect(narration).toMatchObject({
        storageKey: cut?.storageKey,
        contentHash: cut?.contentHash,
      })
    }
  })
})

function memoryStorage(memory: Map<string, Buffer>): StorageAdapter {
  return {
    put: async (key, data) => {
      const bytes =
        typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
      memory.set(key, bytes)
      return key
    },
    get: async (key) => {
      const bytes = memory.get(key)
      if (!bytes) throw new Error('missing test artifact')
      return Buffer.from(bytes)
    },
    exists: async (key) => memory.has(key),
    localPath: (key) => key,
    delete: async (key) => {
      memory.delete(key)
    },
    tempDir: async () => 'test-temp',
    readLocalFile: async () => Buffer.alloc(0),
    removeTempDir: async () => {},
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
