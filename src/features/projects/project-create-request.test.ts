import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateProjectWithSourceInput,
  ProjectCreationDependencies,
} from './project-creation'
import {
  createProjectFromRequest,
  ProjectCreateInputError,
} from './project-create-request'
import { wavBytes } from '@/features/audio/wav.fixture'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'

function created(input: CreateProjectWithSourceInput) {
  return {
    project: {
      id: input.projectId ?? PROJECT_ID,
      kind: input.source.kind,
      title: input.title,
      script: input.source.kind === 'script' ? input.source.script : '',
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    },
    entryNodeId: '20000000-0000-4000-8000-000000000001',
  }
}

describe('createProjectFromRequest JSON', () => {
  it('keeps the legacy script JSON shape and derives its source fingerprint', async () => {
    const createProject = vi.fn(
      async (
        input: CreateProjectWithSourceInput,
        _dependencies?: ProjectCreationDependencies,
      ) => created(input),
    )
    const request = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '旧版文稿入口',
        script: '只存真实产品事实。',
        visualTheme: 'light',
      }),
    })

    const result = await createProjectFromRequest(request, {
      createProject,
      getWorkspaceId: () => WORKSPACE_ID,
      createId: () => PROJECT_ID,
    })

    expect(result.project.kind).toBe('script')
    const [input, dependencies] = createProject.mock.calls[0]!
    expect(input).toMatchObject({
      title: '旧版文稿入口',
      source: {
        schemaVersion: 1,
        kind: 'script',
        script: '只存真实产品事实。',
        visualTheme: 'light',
      },
    })
    expect(input.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(dependencies?.workspaceId).toBe(WORKSPACE_ID)
  })

  it('normalizes a website source and derives a lightweight hostname title', async () => {
    const createProject = vi.fn(
      async (
        input: CreateProjectWithSourceInput,
        _dependencies?: ProjectCreationDependencies,
      ) => created(input),
    )
    const request = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        kind: 'website',
        url: 'HTTPS://Example.COM:443/demo?mode=public#private-panel',
      }),
    })

    await createProjectFromRequest(request, {
      createProject,
      getWorkspaceId: () => WORKSPACE_ID,
      createId: () => PROJECT_ID,
    })

    const [input] = createProject.mock.calls[0]!
    expect(input.title).toBe('网站介绍 · example.com')
    expect(input.source).toEqual({
      schemaVersion: 1,
      kind: 'website',
      url: 'https://example.com/demo?mode=public',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })
  })

  it('rejects JSON audio and undeclared server-owned fields as safe input errors', async () => {
    for (const body of [
      { kind: 'audio', title: '绕过上传', storageKey: 'client/value.wav' },
      {
        kind: 'website',
        url: 'https://example.com',
        storageKey: 'client/value.wav',
      },
    ]) {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      await expect(createProjectFromRequest(request)).rejects.toBeInstanceOf(
        ProjectCreateInputError,
      )
    }
  })
})

describe('createProjectFromRequest audio upload', () => {
  const bytes = wavBytes({
    sampleRateHz: 48_000,
    channels: 1,
    sampleCount: 48_000,
  })
  const storage = {
    put: vi.fn(async (key: string) => key),
    delete: vi.fn(async () => undefined),
  }
  const measure = vi.fn(async (received: Buffer) => {
    expect(received).toEqual(bytes)
    return {
      container: 'wav' as const,
      sampleRateHz: 48_000,
      sampleCount: 48_000,
      durationMs: 1_000,
    }
  })

  beforeEach(() => {
    storage.put.mockClear()
    storage.delete.mockClear()
    measure.mockClear()
  })

  it('trusts measured bytes rather than the browser MIME or filename extension', async () => {
    const createProject = vi.fn(
      async (
        input: CreateProjectWithSourceInput,
        _dependencies?: ProjectCreationDependencies,
      ) => created(input),
    )
    const result = await createProjectFromRequest(audioRequest(bytes), {
      storage,
      measureAudio: measure,
      createProject,
      getWorkspaceId: () => WORKSPACE_ID,
      createId: () => PROJECT_ID,
    })

    expect(result.project.kind).toBe('audio')
    const fingerprint = createHash('sha256').update(bytes).digest('hex')
    const expectedKey =
      `project-sources/${WORKSPACE_ID}/${PROJECT_ID}/${fingerprint}.wav`
    expect(storage.put).toHaveBeenCalledWith(expectedKey, bytes)
    const [input] = createProject.mock.calls[0]!
    expect(input).toMatchObject({
      projectId: PROJECT_ID,
      title: '现场录音',
      sourceFingerprint: fingerprint,
      source: {
        kind: 'audio',
        storageKey: expectedKey,
        fileName: '现场录音.mp3',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: bytes.length,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
      },
    })
    expect(JSON.stringify(input)).not.toContain('audioBytes')
  })

  it('deletes the isolated upload when the database transaction fails', async () => {
    const createProject = vi.fn(async () => {
      throw new Error('injected database failure')
    })

    await expect(
      createProjectFromRequest(audioRequest(bytes), {
        storage,
        measureAudio: measure,
        createProject,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toThrow('injected database failure')

    expect(storage.delete).toHaveBeenCalledOnce()
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]![0])
  })

  it('reports invalid media safely before storage and does not expose decoder output', async () => {
    const unsafeMeasure = vi.fn(async () => {
      throw new Error('ffmpeg output contains a local path and provider detail')
    })

    await expect(
      createProjectFromRequest(audioRequest(bytes), {
        storage,
        measureAudio: unsafeMeasure,
        getWorkspaceId: () => WORKSPACE_ID,
        createId: () => PROJECT_ID,
      }),
    ).rejects.toThrow('无法读取录音，请上传有效的 MP3 或 WAV 文件')
    expect(storage.put).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('rejects client-owned storage metadata in multipart forms', async () => {
    const form = audioForm(bytes)
    form.set('storageKey', 'client/injected.wav')
    const request = new Request('http://localhost/api/projects', {
      method: 'POST',
      body: form,
    })

    await expect(createProjectFromRequest(request)).rejects.toThrow(
      '录音上传表单包含未支持的字段',
    )
    expect(storage.put).not.toHaveBeenCalled()
  })
})

function audioRequest(bytes: Buffer): Request {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    body: audioForm(bytes),
  })
}

function audioForm(bytes: Buffer): FormData {
  const form = new FormData()
  form.set('kind', 'audio')
  form.set(
    'file',
    new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' }),
    '现场录音.mp3',
  )
  form.set('visualTheme', 'light')
  return form
}
