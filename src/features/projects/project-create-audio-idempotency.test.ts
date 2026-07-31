import { beforeEach, describe, expect, it, vi } from 'vitest'
import { wavBytes } from '@/features/audio/wav.fixture'
import type {
  CreateProjectWithSourceInput,
  ProjectCreationDependencies,
} from './project-creation'
import { ProjectCreationIdempotencyError } from './project-creation'
import { createProjectFromRequest } from './project-create-request'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const CREATION_KEY = '30000000-0000-4000-8000-000000000001'
const bytes = wavBytes({
  sampleRateHz: 48_000,
  channels: 1,
  sampleCount: 48_000,
})
const storage = {
  put: vi.fn(async (key: string) => key),
  delete: vi.fn(async () => undefined),
}
const cleanupSourceUpload = vi.fn(async () => undefined)
const measureAudio = vi.fn(async () => ({
  container: 'wav' as const,
  sampleRateHz: 48_000,
  sampleCount: 48_000,
  durationMs: 1_000,
}))

beforeEach(() => {
  storage.put.mockClear()
  storage.delete.mockClear()
  cleanupSourceUpload.mockReset()
  cleanupSourceUpload.mockResolvedValue(undefined)
  measureAudio.mockClear()
})

describe('audio project creation idempotency', () => {
  it('requires a valid creation key before storing the upload', async () => {
    await expect(
      createProjectFromRequest(audioRequest({ idempotencyKey: null }), {
        storage,
        measureAudio,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      message: '录音项目创建请求缺少有效的 Idempotency-Key',
      statusCode: 400,
    })
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('excludes random project storage identity from the request fingerprint', async () => {
    const inputs: CreateProjectWithSourceInput[] = []
    const createProject = vi.fn(
      async (
        input: CreateProjectWithSourceInput,
        _dependencies?: ProjectCreationDependencies,
      ) => {
        inputs.push(input)
        return created(input)
      },
    )

    for (const projectId of [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
    ]) {
      await createProjectFromRequest(audioRequest({}), {
        storage,
        measureAudio,
        createProject,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => projectId,
      })
    }

    expect(inputs[0]?.source).not.toEqual(inputs[1]?.source)
    expect(inputs[0]?.idempotency).toEqual({
      key: CREATION_KEY,
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(inputs[1]?.idempotency).toEqual(inputs[0]?.idempotency)
  })

  it('removes an isolated duplicate upload when the original project is reused', async () => {
    const createProject = vi.fn(
      async (input: CreateProjectWithSourceInput) => ({
        ...created(input),
        reused: true,
      }),
    )

    const result = await createProjectFromRequest(audioRequest({}), {
      storage,
      measureAudio,
      createProject,
      cleanupSourceUpload,
      getWorkspaceId: () => WORKSPACE_ID,
      createId: () => PROJECT_ID,
    })

    expect(result.reused).toBe(true)
    expect(storage.delete).not.toHaveBeenCalled()
    expect(cleanupSourceUpload).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      storageKey: storage.put.mock.calls[0]![0],
      reason: 'duplicate-upload',
    })
  })

  it('fails closed when duplicate upload cleanup cannot be registered', async () => {
    const cleanupError = new Error('cleanup unavailable')
    cleanupSourceUpload.mockRejectedValueOnce(cleanupError)
    const createProject = vi.fn(
      async (input: CreateProjectWithSourceInput) => ({
        ...created(input),
        reused: true,
      }),
    )

    await expect(
      createProjectFromRequest(audioRequest({}), {
        storage,
        measureAudio,
        createProject,
        cleanupSourceUpload,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toBe(cleanupError)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('persists failed creation cleanup without replacing the original error', async () => {
    const creationError = new Error('database unavailable')
    const createProject = vi.fn(async () => {
      throw creationError
    })

    await expect(
      createProjectFromRequest(audioRequest({}), {
        storage,
        measureAudio,
        createProject,
        cleanupSourceUpload,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toBe(creationError)

    expect(cleanupSourceUpload).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      storageKey: storage.put.mock.calls[0]![0],
      reason: 'creation-failed',
    })
  })

  it('maps a conflicting creation key to a safe 409 error', async () => {
    const createProject = vi.fn(async () => {
      throw new ProjectCreationIdempotencyError()
    })

    await expect(
      createProjectFromRequest(audioRequest({}), {
        storage,
        measureAudio,
        createProject,
        cleanupSourceUpload,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
      message: '同一创建请求标识已用于其他项目参数',
    })
  })
})

function audioRequest(input: { idempotencyKey?: string | null }): Request {
  const form = new FormData()
  form.set('kind', 'audio')
  form.set(
    'file',
    new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' }),
    '现场录音.mp3',
  )
  form.set('visualTheme', 'light')
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: input.idempotencyKey === null
      ? undefined
      : { 'idempotency-key': input.idempotencyKey ?? CREATION_KEY },
    body: form,
  })
}

function created(input: CreateProjectWithSourceInput) {
  return {
    project: {
      id: input.projectId ?? PROJECT_ID,
      kind: input.source.kind,
      title: input.title,
      script: '',
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    },
    entryNodeId: '20000000-0000-4000-8000-000000000001',
    reused: false,
  }
}
