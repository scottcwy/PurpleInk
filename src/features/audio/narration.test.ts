import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProviderDispatchWaitError } from '@/features/ai/provider-dispatch-wait-error'
import {
  narrationAudioKey,
  synthesizeNarration,
  type NarrationDependencies,
} from './narration'

vi.mock('server-only', () => ({}))

const ENGINE = 'stepaudio-2.5-tts'

function harness(overrides: Partial<NarrationDependencies> = {}) {
  const synthesize = vi.fn(async (input: { text: string }) => ({
    audioBytes: Buffer.from(`audio:${input.text}`),
    audioFormat: 'mp3' as const,
    durationMs: 99_999,
    model: ENGINE,
    nativeCaptions: [{ text: input.text, startMs: 0, endMs: 100 }],
  }))
  // 实测时长与文本长度真实相关，且与 TTS 自报的 99999ms 无关。
  const measure = vi.fn(async (bytes: Buffer) => ({
    sampleCount: bytes.length * 100,
    sampleRateHz: 24_000,
    durationMs: (bytes.length * 100 * 1000) / 24_000,
    container: 'mp3' as const,
  }))
  const reuseAudio = vi.fn(async () => null as Buffer | null)
  const registerAudio = vi.fn(
    async (input: { audioKey: string; unitId: string }) => ({
      audioArtifactId: `artifact-${input.unitId}`,
      audioKey: input.audioKey,
      version: 1,
    })
  )
  const dependencies: NarrationDependencies = {
    resolveEngine: async () => ({
      provider: 'stepfun',
      model: ENGINE,
      voice: 'cixingnansheng',
      audioFormat: 'mp3',
    }),
    synthesize,
    measure,
    reuseAudio,
    registerAudio,
    ...overrides,
  }
  return { synthesize, measure, reuseAudio, registerAudio, dependencies }
}

describe('synthesizeNarration', () => {
  it('measures each unit from real bytes so long and short text differ', async () => {
    const target = harness()

    const result = await synthesizeNarration(
      {
        projectId: 'project-1',
        nodeId: 'ingest-node',
        units: [
          { unitId: 'U001', text: '短句。' },
          { unitId: 'U002', text: '这是一段明显更长的旁白文本，用于验证时长差异。' },
        ],
      },
      target.dependencies
    )

    expect(result.engine).toBe(ENGINE)
    expect(result.voice).toBe('cixingnansheng')
    expect(result.units.map((unit) => unit.unitId)).toEqual(['U001', 'U002'])
    const [first, second] = result.units
    expect(first?.durationMs).toBeGreaterThan(0)
    expect(second?.durationMs).toBeGreaterThan(first?.durationMs ?? 0)
    expect(first?.durationMs).not.toBe(99_999)
    expect(first?.contentHash).toBe(
      createHash('sha256').update(Buffer.from('audio:短句。')).digest('hex')
    )
    expect(first?.reused).toBe(false)
  })

  it('reuses stored bytes instead of paying for the same text twice', async () => {
    const cached = Buffer.from('audio:重复文本')
    const target = harness({
      reuseAudio: vi.fn(async (key: string) =>
        key ===
        narrationAudioKey({
          projectId: 'project-1',
          engine: ENGINE,
          voice: 'cixingnansheng',
          text: '重复文本',
        })
          ? cached
          : null
      ),
    })

    const result = await synthesizeNarration(
      {
        projectId: 'project-1',
        nodeId: 'ingest-node',
        units: [
          { unitId: 'U001', text: '重复文本' },
          { unitId: 'U002', text: '新文本' },
        ],
      },
      target.dependencies
    )

    expect(target.synthesize).toHaveBeenCalledTimes(1)
    expect(target.synthesize).toHaveBeenCalledWith({
      text: '新文本',
      voiceId: 'cixingnansheng',
    })
    expect(result.units[0]?.reused).toBe(true)
    expect(result.units[1]?.reused).toBe(false)
  })

  it('keeps unit order stable while running lanes in parallel', async () => {
    let active = 0
    let peak = 0
    const target = harness({
      synthesize: vi.fn(async (input: { text: string }) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return {
          audioBytes: Buffer.from(`audio:${input.text}`),
          audioFormat: 'mp3' as const,
          durationMs: 1,
          model: ENGINE,
          nativeCaptions: [],
        }
      }),
    })

    const result = await synthesizeNarration(
      {
        projectId: 'project-1',
        nodeId: 'ingest-node',
        units: Array.from({ length: 6 }, (_, index) => ({
          unitId: `U00${index + 1}`,
          text: `第 ${index + 1} 句`,
        })),
        concurrency: 3,
        staggerMs: 0,
      },
      target.dependencies
    )

    expect(result.units.map((unit) => unit.unitId)).toEqual([
      'U001',
      'U002',
      'U003',
      'U004',
      'U005',
      'U006',
    ])
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('waits for every lane to drain before surfacing an early failure', async () => {
    const firstError = new Error('first lane failed')
    let markSecondStarted!: () => void
    let releaseSecond!: () => void
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let secondCompleted = false
    const target = harness({
      synthesize: vi.fn(async (input: { text: string }) => {
        if (input.text === '第一句') throw firstError
        markSecondStarted()
        await secondGate
        secondCompleted = true
        return {
          audioBytes: Buffer.from(`audio:${input.text}`),
          audioFormat: 'mp3' as const,
          durationMs: 1,
          model: ENGINE,
          nativeCaptions: [],
        }
      }),
    })

    const pending = synthesizeNarration(
      {
        projectId: 'project-1',
        nodeId: 'ingest-node',
        units: [
          { unitId: 'U001', text: '第一句' },
          { unitId: 'U002', text: '第二句' },
        ],
        concurrency: 2,
        staggerMs: 0,
      },
      target.dependencies
    )
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await secondStarted
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseSecond()
    await expect(pending).rejects.toBe(firstError)
    expect(secondCompleted).toBe(true)
    expect(target.registerAudio).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'U002' })
    )
  })

  it('prefers a Provider dispatch wait after every lane settles', async () => {
    const ordinaryError = new Error('ordinary failure')
    const dispatchWait = new ProviderDispatchWaitError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      funding: 'managed',
      retryAt: new Date('2026-07-30T00:00:01.000Z'),
      scopeKey: 'a'.repeat(64),
      waitReason: 'pacing',
    })
    const target = harness({
      synthesize: vi.fn(async (input: { text: string }) => {
        throw input.text === '第一句' ? ordinaryError : dispatchWait
      }),
    })

    await expect(
      synthesizeNarration(
        {
          projectId: 'project-1',
          nodeId: 'ingest-node',
          units: [
            { unitId: 'U001', text: '第一句' },
            { unitId: 'U002', text: '第二句' },
          ],
          concurrency: 2,
          staggerMs: 0,
        },
        target.dependencies
      )
    ).rejects.toBe(dispatchWait)
    expect(target.dependencies.synthesize).toHaveBeenCalledTimes(2)
  })

  it('throws the first lane error when no dispatch wait exists', async () => {
    const firstError = new Error('first failure')
    const secondError = new Error('second failure')
    const target = harness({
      synthesize: vi.fn(async (input: { text: string }) => {
        throw input.text === '第一句' ? firstError : secondError
      }),
    })

    await expect(
      synthesizeNarration(
        {
          projectId: 'project-1',
          nodeId: 'ingest-node',
          units: [
            { unitId: 'U001', text: '第一句' },
            { unitId: 'U002', text: '第二句' },
          ],
          concurrency: 2,
          staggerMs: 0,
        },
        target.dependencies
      )
    ).rejects.toBe(firstError)
  })

  it('fails the whole batch when TTS is unavailable', async () => {
    const target = harness({
      synthesize: vi.fn(async () => {
        throw new Error('尚未配置 StepFun API Key')
      }),
    })

    await expect(
      synthesizeNarration(
        {
          projectId: 'project-1',
          nodeId: 'ingest-node',
          units: [{ unitId: 'U001', text: '短句。' }],
        },
        target.dependencies
      )
    ).rejects.toThrow('StepFun API Key')
    expect(target.registerAudio).not.toHaveBeenCalled()
  })

  it('rejects audio produced by a different model than the configured route', async () => {
    const target = harness({
      synthesize: vi.fn(async () => ({
        audioBytes: Buffer.from('audio'),
        audioFormat: 'mp3' as const,
        durationMs: 1,
        model: 'other-tts',
        nativeCaptions: [],
      })),
    })

    await expect(
      synthesizeNarration(
        {
          projectId: 'project-1',
          nodeId: 'ingest-node',
          units: [{ unitId: 'U001', text: '短句。' }],
        },
        target.dependencies
      )
    ).rejects.toThrow('TTS 模型与配置不一致')
  })
})
