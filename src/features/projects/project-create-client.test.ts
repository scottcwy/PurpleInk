import { describe, expect, it, vi } from 'vitest'
import {
  createProjectAndStart,
  ProjectStartQuotaError,
  startProject,
} from './project-create-client'

describe('createProjectAndStart', () => {
  it('creates an explicit script source and starts the persisted workflow', async () => {
    const fetcher = successfulFetcher('project-script')

    await expect(
      createProjectAndStart(
        {
          kind: 'script',
          title: 'RAG 十分钟入门',
          script: '稿件',
          visualTheme: 'light',
          visualStyle: 'custom',
          customVisualStyle: '使用杂志拼贴与粗线条插画',
        },
        fetcher,
      ),
    ).resolves.toEqual({ projectId: 'project-script' })

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'script',
          title: 'RAG 十分钟入门',
          script: '稿件',
          visualTheme: 'light',
          visualStyle: 'custom',
          customVisualStyle: '使用杂志拼贴与粗线条插画',
        }),
      }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-script/start',
      { method: 'POST' },
    )
  })

  it('creates a website source without exposing workflow routing controls', async () => {
    const fetcher = successfulFetcher('project-website')

    await createProjectAndStart(
      {
        kind: 'website',
        title: 'PurpleInk 官网',
        url: 'https://purple.ink/product',
        durationSec: 24,
        quality: 'standard',
        visualTheme: 'dark',
      },
      fetcher,
    )

    const request = fetcher.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual({
      kind: 'website',
      title: 'PurpleInk 官网',
      url: 'https://purple.ink/product',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })
    expect(request?.headers).toMatchObject({
      'content-type': 'application/json',
      'idempotency-key': expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    })
    expect(String(request?.body)).not.toContain('workflowVersion')
    expect(String(request?.body)).not.toContain('nodeId')
  })

  it('uploads an audio source as multipart and then uses the same start route', async () => {
    const fetcher = successfulFetcher('project-audio')
    const file = new File(['ID3 audio fixture'], '采访录音.mp3', {
      type: 'audio/mpeg',
    })

    await createProjectAndStart(
      {
        kind: 'audio',
        title: '采访成片',
        file,
        visualTheme: 'dark',
      },
      fetcher,
    )

    const request = fetcher.mock.calls[0]?.[1]
    expect(request?.body).toBeInstanceOf(FormData)
    const form = request?.body as FormData
    expect(form.get('kind')).toBe('audio')
    expect(form.get('title')).toBe('采访成片')
    expect(form.get('visualTheme')).toBe('dark')
    expect(form.get('file')).toBe(file)
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-audio/start',
      { method: 'POST' },
    )
  })

  it('preserves the shared quota contract on workflow start', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: 'QUOTA_EXHAUSTED',
          resetAt: '2026-08-01T00:00:00.000Z',
          billingUrl: '/products/billing',
        },
        402,
      ),
    )

    const error = await startProject('project-quota', fetcher).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(ProjectStartQuotaError)
    expect(error).toMatchObject({
      resetAt: '2026-08-01T00:00:00.000Z',
      billingUrl: '/products/billing',
      message: '本周期 AI 额度已用完',
    })
  })
})

function successfulFetcher(projectId: string) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({ ok: true, project: { id: projectId } }, 201),
    )
    .mockResolvedValueOnce(
      jsonResponse({ ok: true, status: 'started' }, 200),
    )
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
