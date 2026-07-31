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

/**
 * ass / fontsdir 路径先过 escapeFilterPath，内部是 path.resolve：写死盘符前缀会在
 * Linux/macOS 上被拼成 <cwd>/C:/...，断言在这些平台恒红。按平台取等价的绝对路径
 * 前缀，Windows 盘符冒号必须转义的规则仍由 win32 分支的期望值覆盖。
 */
const isWindows = process.platform === 'win32'
const abs = (relativePath: string): string =>
  `${isWindows ? 'C:/' : '/'}${relativePath}`
const expectedFontsDirectory = isWindows
  ? String.raw`C\:/repo/assets/fonts`
  : '/repo/assets/fonts'

describe('buildMediaAssemblyArgs', () => {
  const baseInput = {
    plan,
    concatListPath: abs('tmp/shots.ffconcat'),
    narrationPaths: [abs('tmp/a1.mp3'), abs('tmp/a2.mp3')],
    subtitlePath: abs('tmp/final.ass'),
    fontsDirectory: abs('repo/assets/fonts'),
    musicPath: null,
    outputPath: abs('tmp/final.mp4'),
  } as const

  it('builds one deterministic H.264/AAC hard-subtitle assembly without speed changes', () => {
    const args = buildMediaAssemblyArgs(baseInput)
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
    expect(filter).toContain(`fontsdir='${expectedFontsDirectory}'`)
    expect(filter).toContain('aresample=48000')
    expect(filter).toContain('channel_layouts=stereo')
    expect(filter).toContain('atrim=start=0.1:end=0.9')
    expect(filter).toContain('apad')
    expect(filter).toContain('concat=n=2:v=0:a=1')
    expect(command).not.toContain('-an')
    expect(command).not.toContain('atempo')
  })

  it('keeps the off path exactly identical when the SFX input list is empty', () => {
    expect(
      buildMediaAssemblyArgs({ ...baseInput, soundEffectInputs: [] }),
    ).toEqual(buildMediaAssemblyArgs(baseInput))
  })

  it('delays, mixes and limits only the supplied procedural one-shots', () => {
    const args = buildMediaAssemblyArgs({
      ...baseInput,
      soundEffectInputs: [
        { path: abs('tmp/ping.wav'), atFrame: 9, gainDb: -24 },
        { path: abs('tmp/whoosh.wav'), atFrame: 60, gainDb: -24 },
      ],
    })
    const command = args.join(' ')
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(command).toContain(`-i ${abs('tmp/ping.wav')}`)
    expect(command).toContain(`-i ${abs('tmp/whoosh.wav')}`)
    expect(filter).toContain('volume=-24dB,adelay=300|300[sfx0]')
    expect(filter).toContain('volume=-24dB,adelay=2000|2000[sfx1]')
    expect(filter).toContain('amix=inputs=2:duration=longest:normalize=0[sfxbus]')
    expect(filter).toContain(
      'amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.891251[audio]',
    )
    expect(command).toContain('-map [audio]')
    expect(command).not.toContain('stream_loop')
  })

  it('keeps scaling but drops the ass filter for a subtitle-free delivery', () => {
    const args = buildMediaAssemblyArgs({
      plan: { ...plan, subtitles: 'off' },
      concatListPath: abs('tmp/shots.ffconcat'),
      narrationPaths: [abs('tmp/a1.mp3'), abs('tmp/a2.mp3')],
      subtitlePath: null,
      fontsDirectory: abs('repo/assets/fonts'),
      musicPath: null,
      outputPath: abs('tmp/final.mp4'),
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
