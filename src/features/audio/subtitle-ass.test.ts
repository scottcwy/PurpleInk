import { describe, expect, it } from 'vitest'
import {
  buildAssDocument,
  normalizeSubtitleTrack,
  normalizeSubtitleTrackWithWholeClipFallback,
} from './subtitle-ass'

describe('normalizeSubtitleTrack', () => {
  it('uses trusted source text for one valid whole-clip timestamp with ASR drift', () => {
    expect(normalizeSubtitleTrackWithWholeClipFallback({
      sourceText: 'Chromium 按时间轴渲染镜头并保存真实 MP4',
      audioDurationMs: 1_000,
      captions: [{
        text: '按时间轴渲染镜头并保存视频',
        startMs: 0,
        endMs: 900,
      }],
    }).map((cue) => cue.text).join('')).toBe(
      'Chromium 按时间轴渲染镜头并保存真实 MP4'
    )
  })

  it('merges zero-duration captions and always renders the source script', () => {
    const cues = normalizeSubtitleTrack({
      sourceText: '你好，真实世界。',
      audioDurationMs: 2_400,
      captions: [
        { text: '你好', startMs: 0, endMs: 600 },
        { text: '真', startMs: 600, endMs: 600 },
        { text: '是世界', startMs: 600, endMs: 2_400 },
      ],
    })

    expect(cues.map((cue) => cue.text).join('')).toBe('你好，真实世界。')
    expect(cues.every((cue) => cue.endMs > cue.startMs)).toBe(true)
    expect(cues.every((cue) => cue.lines.every((line) => [...line].length <= 18))).toBe(true)
    expect(cues.every((cue) => cue.lines.length <= 2)).toBe(true)
  })

  it.each([
    {
      name: '倒序时间',
      captions: [
        { text: '你', startMs: 500, endMs: 900 },
        { text: '好', startMs: 400, endMs: 1_000 },
      ],
    },
    {
      name: '越过音频时长',
      captions: [{ text: '你好', startMs: 0, endMs: 1_001 }],
    },
    {
      name: '严重文本漂移',
      captions: [{ text: '完全不同且长度非常非常长', startMs: 0, endMs: 1_000 }],
    },
  ])('rejects $name', ({ captions }) => {
    expect(() =>
      normalizeSubtitleTrack({
        sourceText: '你好',
        audioDurationMs: 1_000,
        captions,
      })
    ).toThrow()
  })

  it('rejects a timeline made only of zero-duration captions', () => {
    expect(() =>
      normalizeSubtitleTrack({
        sourceText: '你好',
        audioDurationMs: 1_000,
        captions: [{ text: '你好', startMs: 200, endMs: 200 }],
      })
    ).toThrow('零时长')
  })
})

describe('buildAssDocument', () => {
  it('uses exact prior-frame offsets and escapes ASS control characters', () => {
    const ass = buildAssDocument({
      fps: 30,
      targetResolution: { width: 1280, height: 720 },
      shots: [
        {
          laneKey: 'S001',
          durationInFrames: 31,
          sourceText: '第一镜',
          audioDurationMs: 1_000,
          captions: [{ text: '第一镜', startMs: 0, endMs: 1_000 }],
        },
        {
          laneKey: 'S002',
          durationInFrames: 30,
          sourceText: String.raw`第二\{镜}`,
          audioDurationMs: 1_000,
          captions: [
            { text: String.raw`第二\{镜}`, startMs: 0, endMs: 1_000 },
          ],
        },
      ],
    })

    expect(ass).toContain('PlayResX: 1920')
    expect(ass).toContain('PlayResY: 1080')
    expect(ass).toContain('Style: Default,sans-serif,52')
    expect(ass).toContain('Dialogue: 0,0:00:01.03,0:00:02.03')
    expect(ass).toContain(String.raw`第二\\\{镜\}`)
  })

  it('wraps long CJK text into at most two 18-grapheme lines', () => {
    const text = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    const ass = buildAssDocument({
      fps: 30,
      targetResolution: { width: 1920, height: 1080 },
      shots: [
        {
          laneKey: 'S001',
          durationInFrames: 120,
          sourceText: text,
          audioDurationMs: 4_000,
          captions: [{ text, startMs: 0, endMs: 4_000 }],
        },
      ],
    })

    const dialogue = ass.split('\n').find((line) => line.startsWith('Dialogue:'))
    expect(dialogue?.split(String.raw`\N`)).toHaveLength(2)
  })
})
