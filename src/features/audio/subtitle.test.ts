import { describe, expect, it, vi } from 'vitest'
import { generateSubtitle } from './subtitle'

vi.mock('server-only', () => ({}))

describe('generateSubtitle', () => {
  it('uses timestamped StepFun ASR output and stores a traceable subtitle track', async () => {
    const transcribe = vi.fn(async () => ({
      transcript: '你好世界',
      model: 'stepaudio-2.5-asr',
      captions: [
        { text: '你好', startMs: 0, endMs: 300 },
        { text: '世界', startMs: 300, endMs: 750 },
      ],
    }))
    const storeArtifact = vi.fn(async (input: unknown) => {
      void input
      return {
        id: 'subtitle-artifact',
        storageKey: 'audio/project-1/S001/subtitle-track-hash.json',
        contentHash: 'subtitle-hash',
      }
    })

    const result = await generateSubtitle(
      {
        projectId: 'project-1',
        nodeId: 'subtitle-node',
        shotId: 'S001',
        script: '你好世界',
        audioArtifactId: 'audio-artifact',
        audioKey: 'audio/project-1/S001/voiceover.mp3',
        audioBytes: Buffer.from([1, 2, 3]),
        audioFormat: 'mp3',
      },
      {
        transcribe,
        measure: measuredAudio,
        storeArtifact,
      }
    )

    expect(transcribe).toHaveBeenCalledWith({
      audioBytes: Buffer.from([1, 2, 3]),
      audioFormat: 'mp3',
      audioSeconds: 1,
      billingContext: undefined,
    })
    const trackWrite = storeArtifact.mock.calls[0]?.[0] as Record<string, unknown>
    expect(trackWrite).toMatchObject({
      projectId: 'project-1',
      nodeId: 'subtitle-node',
      shotId: 'S001',
      kind: 'subtitle-track',
      extension: 'json',
    })
    expect(JSON.parse(String(trackWrite.data))).toEqual({
      version: 1,
      shotId: 'S001',
      sourceText: '你好世界',
      transcript: '你好世界',
      model: 'stepaudio-2.5-asr',
      alignmentSource: 'stepfun-asr',
      sourceAudioArtifactId: 'audio-artifact',
      sourceAudioKey: 'audio/project-1/S001/voiceover.mp3',
      captions: [
        { text: '你好', startMs: 0, endMs: 300 },
        { text: '世界', startMs: 300, endMs: 750 },
      ],
    })
    expect(result).toEqual({
      kind: 'subtitle',
      status: 'ready',
      shotId: 'S001',
      transcript: '你好世界',
      model: 'stepaudio-2.5-asr',
      alignmentSource: 'stepfun-asr',
      captions: [
        { text: '你好', startMs: 0, endMs: 300 },
        { text: '世界', startMs: 300, endMs: 750 },
      ],
      trackArtifactId: 'subtitle-artifact',
      trackKey: 'audio/project-1/S001/subtitle-track-hash.json',
    })
  })

  it('refuses to fabricate a timeline when ASR returns no timed deltas', async () => {
    await expect(
      generateSubtitle(
        {
          projectId: 'project-1',
          nodeId: 'subtitle-node',
          shotId: 'S001',
          script: '你好',
          audioArtifactId: 'audio-artifact',
          audioKey: 'voiceover.mp3',
          audioBytes: Buffer.from([1]),
          audioFormat: 'mp3',
        },
        {
          transcribe: vi.fn(async () => ({
            transcript: '你好',
            model: 'stepaudio-2.5-asr',
            captions: [],
          })),
          measure: measuredAudio,
          storeArtifact: vi.fn(),
        }
      )
    ).rejects.toThrow('时间戳')
  })

  it('uses the measured whole-shot interval for MiMo segment-level ASR', async () => {
    const storeArtifact = vi.fn(async () => ({
      id: 'subtitle-artifact',
      storageKey: 'subtitle.json',
      contentHash: 'hash',
    }))
    const result = await generateSubtitle(
      {
        projectId: 'project-1',
        nodeId: 'subtitle-node',
        shotId: 'S001',
        script: '你好世界',
        audioArtifactId: 'audio-artifact',
        audioKey: 'voiceover.wav',
        audioBytes: Buffer.from([1, 2, 3]),
        audioFormat: 'wav',
      },
      {
        transcribe: vi.fn(async () => ({
          transcript: '你好世界',
          model: 'mimo-v2.5-asr',
          captions: [],
          alignmentSource: 'mimo-asr-segment' as const,
        })),
        measure: vi.fn(async () => ({
          durationMs: 1250,
          sampleRateHz: 24_000,
          sampleCount: 30_000,
          container: 'wav' as const,
        })),
        storeArtifact,
      }
    )

    expect(result.alignmentSource).toBe('mimo-asr-segment')
    expect(result.captions).toEqual([
      { text: '你好世界', startMs: 0, endMs: 1250 },
    ])
  })

  it('repairs a drifting whole-shot ASR caption with the trusted source text', async () => {
    let storedData = ''
    const storeArtifact = vi.fn(async (input: unknown) => {
      storedData = (input as { data: string }).data
      return {
        id: 'subtitle-artifact',
        storageKey: 'subtitle.json',
        contentHash: 'hash',
      }
    })
    const result = await generateSubtitle(
      {
        projectId: 'project-1',
        nodeId: 'subtitle-node',
        shotId: 'S005',
        script: 'Chromium 按时间轴渲染镜头并保存真实 MP4',
        audioArtifactId: 'audio-artifact',
        audioKey: 'voiceover.wav',
        audioBytes: Buffer.from([1, 2, 3]),
        audioFormat: 'wav',
      },
      {
        transcribe: vi.fn(async () => ({
          transcript: '按时间轴渲染镜头并保存视频',
          model: 'mimo-v2.5-asr',
          captions: [
            { text: '按时间轴渲染镜头并保存视频', startMs: 0, endMs: 900 },
          ],
          alignmentSource: 'mimo-asr-segment' as const,
        })),
        measure: measuredAudio,
        storeArtifact,
      }
    )

    expect(result.captions).toEqual([{
      text: 'Chromium 按时间轴渲染镜头并保存真实 MP4',
      startMs: 0,
      endMs: 900,
    }])
    expect(JSON.parse(storedData).transcript).toBe('按时间轴渲染镜头并保存视频')
  })

  it('rejects multi-segment ASR drift instead of persisting an invalid track', async () => {
    const storeArtifact = vi.fn()
    await expect(generateSubtitle(
      {
        projectId: 'project-1',
        nodeId: 'subtitle-node',
        shotId: 'S005',
        script: '这是完整且可信的原稿内容',
        audioArtifactId: 'audio-artifact',
        audioKey: 'voiceover.wav',
        audioBytes: Buffer.from([1, 2, 3]),
        audioFormat: 'wav',
      },
      {
        transcribe: vi.fn(async () => ({
          transcript: '完全不同',
          model: 'mimo-v2.5-asr',
          captions: [
            { text: '完全', startMs: 0, endMs: 400 },
            { text: '不同', startMs: 400, endMs: 900 },
          ],
          alignmentSource: 'mimo-asr-segment' as const,
        })),
        measure: measuredAudio,
        storeArtifact,
      }
    )).rejects.toThrow('漂移')
    expect(storeArtifact).not.toHaveBeenCalled()
  })
})

async function measuredAudio() {
  return {
    durationMs: 1000,
    sampleRateHz: 24_000,
    sampleCount: 24_000,
    container: 'mp3' as const,
  }
}
