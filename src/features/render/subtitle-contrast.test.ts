import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { probeSubtitleContrast } from './subtitle-contrast'

vi.mock('server-only', () => ({}))

/**
 * 明度探针跑真实 ffmpeg。合成三段纯色片段而不是用固定 fixture 文件：判定阈值是对
 * 「字幕带实测明度」的断言，用真实解码取证才有意义，mock 出来的数字证明不了任何事。
 */
function synthesize(directory: string, name: string, color: string): string {
  const output = join(directory, `${name}.mp4`)
  const result = spawnSync(
    ffmpegPath!,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
    ],
    { windowsHide: true }
  )
  if (result.status !== 0) {
    throw new Error(`合成测试片段失败：${result.stderr.toString().trim()}`)
  }
  return output
}

describe('probeSubtitleContrast', () => {
  let work: string
  let dark: string
  let light: string
  let mid: string

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'cvc-contrast-probe-'))
    // 640x360 而不是 1920x1080：探针的 crop 用画幅比例表达，必须对非母版尺寸也成立。
    dark = synthesize(work, 'dark', '0x101014')
    light = synthesize(work, 'light', '0xf4f4f6')
    mid = synthesize(work, 'mid', '0x7a7a80')
  })

  afterAll(() => {
    rmSync(work, { recursive: true, force: true })
  })

  it('reads a dark subtitle band as on-dark', async () => {
    await expect(probeSubtitleContrast(dark)).resolves.toBe('on-dark')
  })

  it('reads a light subtitle band as on-light', async () => {
    await expect(probeSubtitleContrast(light)).resolves.toBe('on-light')
  })

  it('keeps mid grey on the safer dark-background style', async () => {
    // 中灰实测 YAVG 约 121，低于 140 阈值：模糊地带偏向白字黑描边。
    await expect(probeSubtitleContrast(mid)).resolves.toBe('on-dark')
  })

  it('falls back to on-dark for a missing file without spawning ffmpeg', async () => {
    await expect(
      probeSubtitleContrast(join(work, 'does-not-exist.mp4'))
    ).resolves.toBe('on-dark')
  })
})
