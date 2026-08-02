import { beforeEach, describe, expect, it, vi } from 'vitest'

const aws = vi.hoisted(() => {
  const commands: Array<{ input: Record<string, unknown> }> = []
  const state: { headResponse: { Metadata?: Record<string, string> } } = {
    headResponse: {},
  }

  class S3Command {
    constructor(readonly input: Record<string, unknown>) {
      commands.push(this)
    }
  }

  class PutObjectCommand extends S3Command {}
  class GetObjectCommand extends S3Command {}
  class HeadObjectCommand extends S3Command {}
  class DeleteObjectCommand extends S3Command {}

  class S3Client {
    constructor(readonly config: Record<string, unknown>) {}

    async send(command: S3Command): Promise<unknown> {
      if (command instanceof HeadObjectCommand) return state.headResponse
      return {}
    }
  }

  return {
    commands,
    state,
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
  }
})

vi.mock('@aws-sdk/client-s3', () => aws)
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://r2.example.test/signed'),
}))

import { S3RemoteStore } from './s3-remote-store'

describe('S3RemoteStore SDK mapping', () => {
  beforeEach(() => {
    aws.commands.length = 0
    aws.state.headResponse = {}
  })

  function createStore() {
    return new S3RemoteStore({
      endpoint: 'https://r2.example.test',
      bucket: 'artifacts',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
  }

  it('passes user metadata through PutObject', async () => {
    await createStore().putObject('nested/video.mp4', Buffer.from('bytes'), {
      metadata: { 'content-sha256': 'a'.repeat(64) },
    })

    expect(aws.commands[0]).toMatchObject({
      input: {
        Bucket: 'artifacts',
        Key: 'nested/video.mp4',
        Metadata: { 'content-sha256': 'a'.repeat(64) },
      },
    })
  })

  it('normalizes HeadObject metadata and preserves an absent field as absent', async () => {
    const store = createStore()
    aws.state.headResponse = {
      Metadata: { 'content-sha256': 'a'.repeat(64) },
    }
    await expect(store.getObjectMetadata('video.mp4')).resolves.toEqual({
      'content-sha256': 'a'.repeat(64),
    })
    expect(aws.commands[0]).toMatchObject({
      input: { Bucket: 'artifacts', Key: 'video.mp4' },
    })

    aws.commands.length = 0
    aws.state.headResponse = {}
    await expect(store.getObjectMetadata('video.mp4')).resolves.toEqual({})
  })
})
