import { describe, expect, it, vi } from 'vitest'
import type { MediaAssemblyPlan } from './media-assembly'
import {
  runMediaAssemblyWithSfxFallback,
  type PreparedProceduralSfx,
} from './procedural-sfx-mix'

const plan: MediaAssemblyPlan = {
  fps: 30,
  totalFrames: 30,
  targetResolution: { width: 1280, height: 720 },
  musicKey: null,
  subtitles: 'off',
  soundEffects: 'procedural',
  shots: [
    {
      laneKey: 'S001',
      video: { artifactId: 'v1', storageKey: 'v1.mp4', contentHash: 'a'.repeat(64) },
      durationInFrames: 30,
      narration: {
        unitId: 'U001',
        artifact: { artifactId: 'a1', storageKey: 'a1.mp3', contentHash: 'b'.repeat(64) },
        startInUnitMs: 0,
        endInUnitMs: 1_000,
      },
      subtitle: null,
    },
  ],
}

const baseInput = {
  plan,
  concatListPath: 'C:/tmp/shots.ffconcat',
  narrationPaths: ['C:/tmp/a1.mp3'],
  subtitlePath: null,
  fontsDirectory: 'C:/repo/assets/fonts',
  musicPath: null,
  outputPath: 'C:/tmp/final.mp4',
} as const

const prepared: PreparedProceduralSfx = {
  inputs: [{ path: 'C:/tmp/ping.wav', atFrame: 9, gainDb: -24 }],
  result: {
    mode: 'procedural',
    status: 'applied',
    generatorVersion: 'procedural-sfx/1.0.0',
    cueCount: 1,
    timingHash: 'a'.repeat(64),
    cuePlanHash: 'b'.repeat(64),
    waveformHashes: ['c'.repeat(64)],
  },
}

describe('runMediaAssemblyWithSfxFallback', () => {
  it('retries once without SFX and reports omitted-error when only SFX mixing fails', async () => {
    const runner = vi
      .fn<(args: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('SFX branch failed'))
      .mockResolvedValueOnce()

    const result = await runMediaAssemblyWithSfxFallback({
      baseInput,
      prepared,
      runner,
    })

    expect(result).toMatchObject({
      status: 'omitted-error',
      failureCode: 'PROCEDURAL_SFX_MIX_FAILED',
    })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls[0]![0].join(' ')).toContain('adelay=')
    expect(runner.mock.calls[1]![0].join(' ')).not.toContain('adelay=')
  })

  it('does not hide a base assembly failure behind the SFX fallback', async () => {
    const baseFailure = new Error('base narration failed')
    const runner = vi
      .fn<(args: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first pass failed'))
      .mockRejectedValueOnce(baseFailure)

    await expect(
      runMediaAssemblyWithSfxFallback({ baseInput, prepared, runner }),
    ).rejects.toBe(baseFailure)
  })

  it('runs the original argument path once when SFX is omitted', async () => {
    const runner = vi.fn<(args: string[]) => Promise<void>>().mockResolvedValue()
    const omitted: PreparedProceduralSfx = {
      inputs: [],
      result: {
        mode: 'off',
        status: 'omitted-off',
        generatorVersion: 'procedural-sfx/1.0.0',
        cueCount: 0,
        timingHash: null,
        cuePlanHash: null,
        waveformHashes: [],
      },
    }

    const result = await runMediaAssemblyWithSfxFallback({
      baseInput,
      prepared: omitted,
      runner,
    })

    expect(result.status).toBe('omitted-off')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0]![0].join(' ')).not.toContain('adelay=')
  })
})
