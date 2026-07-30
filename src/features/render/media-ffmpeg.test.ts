import { describe, expect, it, vi } from 'vitest'
import type { MediaAssemblyPlan } from './media-assembly'
import { buildMediaAssemblyArgs } from './media-ffmpeg-args'

vi.mock('server-only', () => ({}))

const plan: MediaAssemblyPlan = {
  fps: 30,
  totalFrames: 90,
  targetResolution: { width: 1280, height: 720 },
  musicKey: null,
  subtitles: 'burn-in',
  shots: [
    {
      laneKey: 'S001',
      video: { artifactId: 'v1', storageKey: 'v1.mp4', contentHash: 'a'.repeat(64) },
      durationInFrames: 30,
      narration: {
        unitId: 'U001',
        artifact: { artifactId: 'a1', storageKey: 'a1.mp3', contentHash: 'b'.repeat(64) },
        startInUnitMs: 100,
        endInUnitMs: 900,
      },
      subtitle: { artifactId: 's1', storageKey: 's1.json', contentHash: 'c'.repeat(64) },
    },
    {
      laneKey: 'S002',
      video: { artifactId: 'v2', storageKey: 'v2.mp4', contentHash: 'd'.repeat(64) },
      durationInFrames: 60,
      narration: {
        unitId: 'U002',
        artifact: { artifactId: 'a2', storageKey: 'a2.mp3', contentHash: 'e'.repeat(64) },
        startInUnitMs: 0,
        endInUnitMs: 1_500,
      },
      subtitle: { artifactId: 's2', storageKey: 's2.json', contentHash: 'f'.repeat(64) },
    },
  ],
}

describe('buildMediaAssemblyArgs', () => {
  it('builds one deterministic H.264/AAC hard-subtitle assembly without speed changes', () => {
    const args = buildMediaAssemblyArgs({
      plan,
      concatListPath: 'C:/tmp/shots.ffconcat',
      narrationPaths: ['C:/tmp/a1.mp3', 'C:/tmp/a2.mp3'],
      subtitlePath: 'C:/tmp/final.ass',
      fontsDirectory: 'C:/repo/assets/fonts',
      musicPath: null,
      outputPath: 'C:/tmp/final.mp4',
    })
    const command = args.join(' ')
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(command).toContain('libx264')
    expect(command).toContain('-crf 18')
    expect(command).toContain('-preset veryfast')
    expect(command).toContain('-pix_fmt yuv420p')
    expect(command).toContain('-c:a aac')
    expect(command).toContain('-b:a 192k')
    expect(filter).toContain('ass=')
    // 必须显式指定字体目录：缺了它 libass 退回宿主 fontconfig，中英会分属两个 face。
    expect(filter).toContain(String.raw`fontsdir='C\:/repo/assets/fonts'`)
    expect(filter).toContain('aresample=48000')
    expect(filter).toContain('channel_layouts=stereo')
    expect(filter).toContain('atrim=start=0.1:end=0.9')
    expect(filter).toContain('apad')
    expect(filter).toContain('concat=n=2:v=0:a=1')
    expect(command).not.toContain('-an')
    expect(command).not.toContain('atempo')
  })

  it('keeps scaling but drops the ass filter for a subtitle-free delivery', () => {
    const args = buildMediaAssemblyArgs({
      plan: { ...plan, subtitles: 'off' },
      concatListPath: 'C:/tmp/shots.ffconcat',
      narrationPaths: ['C:/tmp/a1.mp3', 'C:/tmp/a2.mp3'],
      subtitlePath: null,
      fontsDirectory: 'C:/repo/assets/fonts',
      musicPath: null,
      outputPath: 'C:/tmp/final.mp4',
    })
    const command = args.join(' ')
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(filter).toContain('scale=1280:720:flags=lanczos')
    expect(filter).not.toContain('ass=')
    expect(filter).not.toContain('fontsdir')
    // 音频链与编码参数不受字幕开关影响。
    expect(filter).toContain('concat=n=2:v=0:a=1')
    expect(command).toContain('libx264')
    expect(command).toContain('-c:a aac')
    expect(command).toContain('-map [narration]')
  })
})
