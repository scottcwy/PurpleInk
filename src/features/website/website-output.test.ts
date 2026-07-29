import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { WebsiteEngineJob } from './engine-client'
import {
  assertMp4Bytes,
  persistWebsiteVideoOutput,
} from './website-output'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'

describe('website video output persistence', () => {
  it('stores real bytes and commits their actual hash and size', async () => {
    const bytes = mp4Fixture()
    const put = vi.fn(async (
      key: string,
      _data: Buffer | Uint8Array | string,
    ) => key)
    const commitArtifact = vi.fn(async () => ({
      artifactId: 'artifact-1',
      version: 1,
    }))

    const output = await persistWebsiteVideoOutput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      job: completedJob(),
      videoBytes: bytes,
    }, {
      storage: { put, delete: vi.fn(async () => undefined) },
      commitArtifact,
    })

    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    expect(output).toMatchObject({
      artifactId: 'artifact-1',
      contentHash: expectedHash,
      sizeBytes: bytes.byteLength,
      durationSec: 27.25,
      durationSource: 'output',
      elapsedSec: 27.25,
      verification: {
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 2,
        outcome: 'passed',
      },
    })
    expect(commitArtifact).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'project',
      aggregateId: PROJECT_ID,
      kind: 'website-video-mp4',
      contentHash: expectedHash,
      sizeBytes: bytes.byteLength,
      attemptId: ATTEMPT_ID,
    }))
    expect(put.mock.calls[0]?.[1]).toEqual(bytes)
  })

  it('rejects non-MP4 bytes before storage or artifact registration', async () => {
    const put = vi.fn()
    const commitArtifact = vi.fn()
    await expect(persistWebsiteVideoOutput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      job: completedJob(),
      videoBytes: Buffer.from('not an mp4 file'),
    }, {
      storage: { put, delete: vi.fn() },
      commitArtifact,
    })).rejects.toMatchObject({ code: 'WEBSITE_VIDEO_INVALID' })
    expect(put).not.toHaveBeenCalled()
    expect(commitArtifact).not.toHaveBeenCalled()
  })

  it('removes the exact uncommitted object when artifact commit fails', async () => {
    const bytes = mp4Fixture()
    const remove = vi.fn(async (_key: string) => undefined)
    const failure = new Error('commit failed')
    await expect(persistWebsiteVideoOutput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      job: completedJob(),
      videoBytes: bytes,
    }, {
      storage: { put: async (key) => key, delete: remove },
      commitArtifact: vi.fn(async () => {
        throw failure
      }),
    })).rejects.toBe(failure)
    expect(remove).toHaveBeenCalledOnce()
    expect(remove.mock.calls[0]?.[0]).toContain(ATTEMPT_ID)
  })

  it('accepts bounded ISO BMFF bytes with ftyp, moov, and mdat boxes', () => {
    expect(() => assertMp4Bytes(mp4Fixture())).not.toThrow()
  })

  it('rejects a header-only ftyp payload without media and movie metadata', () => {
    expect(() => assertMp4Bytes(ftypBox())).toThrowError(
      expect.objectContaining({ code: 'WEBSITE_VIDEO_INVALID' }),
    )
  })

  it('rejects otherwise plausible boxes when trailing bytes are truncated', () => {
    const truncated = Buffer.concat([mp4Fixture(), Buffer.from([0x00, 0x00])])
    expect(() => assertMp4Bytes(truncated)).toThrowError(
      expect.objectContaining({ code: 'WEBSITE_VIDEO_INVALID' }),
    )
  })
})

function mp4Fixture(): Buffer {
  const movieHeader = Buffer.alloc(100)
  movieHeader[0] = 0
  return Buffer.concat([
    ftypBox(),
    isoBox('moov', isoBox('mvhd', movieHeader)),
    isoBox('mdat', Buffer.from([0x01, 0x02, 0x03, 0x04])),
  ])
}

function ftypBox(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32,
  ])
}

function isoBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(header.byteLength + payload.byteLength)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function completedJob(): WebsiteEngineJob {
  return {
    id: 'job-1',
    requestId: 'request-1',
    origin: 'https://example.com',
    status: 'done',
    phase: 'done',
    durationSec: 27.25,
    durationSource: 'output',
    elapsedSec: 27.25,
    checkPassed: true,
    goldenVerified: true,
    goldenCheckCount: 2,
    hasVideo: true,
    videoUrl: '/video',
    failure: null,
  }
}
