import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { inspectVideoArtifact, type FfprobeRunner } from './media'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('inspectVideoArtifact', () => {
  it('records real bytes and ffprobe metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-media-'))
    roots.push(root)
    const path = join(root, 'video.mp4')
    await writeFile(path, Buffer.from('video-bytes'))
    const runner: FfprobeRunner = async () => JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', duration: '14' }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '14' },
    })

    const result = await inspectVideoArtifact(path, { expectedDurationSec: 14, runner })

    expect(result.passed).toBe(true)
    expect(result.sizeBytes).toBe(11)
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.metadata).toMatchObject({ width: 1920, height: 1080, durationSec: 14 })
  })

  it('fails when ffprobe has no video stream or duration is wrong', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-media-'))
    roots.push(root)
    const path = join(root, 'video.mp4')
    await writeFile(path, Buffer.from('video-bytes'))
    const runner: FfprobeRunner = async () => JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '2' } })

    const result = await inspectVideoArtifact(path, { expectedDurationSec: 14, runner })

    expect(result.passed).toBe(false)
    expect(result.errors.join(' ')).toMatch(/ffprobe|media/i)
  })
})
