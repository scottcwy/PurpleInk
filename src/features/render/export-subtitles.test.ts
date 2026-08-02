import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import { buildSubtitleAss } from './export-subtitles'
import type { MediaAssemblyPlan } from './media-assembly'

vi.mock('server-only', () => ({}))

describe('buildSubtitleAss', () => {
  it('materializes each video before probing subtitle contrast', async () => {
    const storage: StorageAdapter = {
      put: vi.fn(),
      get: vi.fn(),
      exists: vi.fn(),
      localPath: vi.fn(() => {
        throw new Error('direct localPath must not be used')
      }),
      materializeLocalPath: vi.fn(async () => '/trusted/S001.mp4'),
      delete: vi.fn(),
      tempDir: vi.fn(),
      readLocalFile: vi.fn(),
      removeTempDir: vi.fn(),
    }
    const probeContrast = vi.fn(async () => 'on-dark' as const)

    await expect(
      buildSubtitleAss(plan(), storage, probeContrast),
    ).resolves.toContain('Dialogue:')

    expect(storage.materializeLocalPath).toHaveBeenCalledWith(
      'render/S001.mp4',
    )
    expect(probeContrast).toHaveBeenCalledWith('/trusted/S001.mp4')
  })
})

function plan(): MediaAssemblyPlan {
  return {
    fps: 30,
    totalFrames: 60,
    shots: [{
      laneKey: 'S001',
      video: {
        artifactId: 'video-S001',
        storageKey: 'render/S001.mp4',
        contentHash: '1'.repeat(64),
      },
      durationInFrames: 60,
      narration: {
        unitId: 'U001',
        artifact: {
          artifactId: 'audio-U001',
          storageKey: 'audio/U001.mp3',
          contentHash: '2'.repeat(64),
        },
        startInUnitMs: 0,
        endInUnitMs: 2_000,
      },
      subtitle: null,
    }],
    targetResolution: { width: 1920, height: 1080 },
    musicKey: null,
    subtitles: 'burn-in',
    soundEffects: 'off',
  }
}
