import { describe, expect, it, vi } from 'vitest'
import {
  presignArtifactDownload,
  type PresignDownloadOptions,
} from './presign'

const HASH = 'a'.repeat(64)

function capableStorage() {
  return {
    presignDownloadUrl: vi.fn(
      async (_key: string, _ttl: number, _options: PresignDownloadOptions) =>
        'https://r2.example.test/signed',
    ),
  }
}

describe('presignArtifactDownload', () => {
  it('returns null when the storage adapter has no presign capability', async () => {
    await expect(presignArtifactDownload({}, {
      storageKey: 'projects/p/final.mp4',
      kind: 'final-mp4',
      contentHash: HASH,
      attachment: false,
      ttlSeconds: 300,
    })).resolves.toBeNull()
  })

  it.each(['final-mp4', 'website-video-mp4'])(
    'requires a registered SHA-256 before signing protected %s bytes',
    async (kind) => {
      const storage = capableStorage()

      await expect(presignArtifactDownload(storage, {
        storageKey: `projects/p/${kind}.mp4`,
        kind,
        contentHash: null,
        attachment: false,
        ttlSeconds: 300,
      })).rejects.toThrow('hash')

      expect(storage.presignDownloadUrl).not.toHaveBeenCalled()
    },
  )

  it('forwards the protected hash and inline response type exactly once', async () => {
    const storage = capableStorage()

    await expect(presignArtifactDownload(storage, {
      storageKey: 'projects/p/final.mp4',
      kind: 'final-mp4',
      contentHash: HASH,
      attachment: false,
      ttlSeconds: 300,
    })).resolves.toBe('https://r2.example.test/signed')

    expect(storage.presignDownloadUrl).toHaveBeenCalledWith(
      'projects/p/final.mp4',
      300,
      {
        expectedContentSha256: HASH,
        response: { contentType: 'video/mp4' },
      },
    )
  })

  it('adds a hash-traceable disposition only for attachment delivery', async () => {
    const storage = capableStorage()

    await presignArtifactDownload(storage, {
      storageKey: 'projects/p/final.mp4',
      kind: 'final-mp4',
      contentHash: HASH,
      attachment: true,
      ttlSeconds: 300,
    })

    expect(storage.presignDownloadUrl).toHaveBeenCalledWith(
      'projects/p/final.mp4',
      300,
      {
        expectedContentSha256: HASH,
        response: {
          contentType: 'video/mp4',
          contentDisposition:
            `attachment; filename="final-mp4-${HASH.slice(0, 12)}.mp4"`,
        },
      },
    )
  })

  it('allows unprotected artifacts to sign without a hash metadata gate', async () => {
    const storage = capableStorage()

    await presignArtifactDownload(storage, {
      storageKey: 'projects/p/spec.json',
      kind: 'director-shot-spec',
      contentHash: null,
      attachment: false,
      ttlSeconds: 300,
    })

    expect(storage.presignDownloadUrl).toHaveBeenCalledWith(
      'projects/p/spec.json',
      300,
      {
        response: { contentType: 'application/json; charset=utf-8' },
      },
    )
  })
})
