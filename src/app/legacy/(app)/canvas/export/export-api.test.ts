import { describe, expect, it, vi } from 'vitest'
import { loadExportReadiness, startProjectExport, updateExportResolution } from './export-api'

describe('export API client', () => {
  it('loads incomplete nodes and keeps export disabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ok: true,
        ready: false,
        incompleteNodeIds: ['node-2'],
        shotCount: 1,
        shotQa: { S001: null, S002: true },
        resolutionPreset: '720x1280',
        artifactUrl: '/api/artifacts/final?projectId=project-1',
      })
    )
    await expect(loadExportReadiness('project-1', fetcher)).resolves.toEqual({
      ready: false,
      incompleteNodeIds: ['node-2'],
      shotCount: 1,
      shotQa: { S001: null, S002: true },
      resolutionPreset: '720x1280',
      artifactUrl: '/api/artifacts/final?projectId=project-1',
    })
  })

  it('defaults shotQa/resolutionPreset when the response omits them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, ready: true, incompleteNodeIds: [], shotCount: 0 })
    )
    await expect(loadExportReadiness('project-1', fetcher)).resolves.toEqual({
      ready: true,
      incompleteNodeIds: [],
      shotCount: 0,
      shotQa: {},
      resolutionPreset: '1080x1920',
    })
  })

  it('returns the controlled final artifact URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, artifactUrl: '/api/artifacts/final?projectId=project-1' })
    )
    await expect(startProjectExport('project-1', fetcher)).resolves.toBe(
      '/api/artifacts/final?projectId=project-1'
    )
  })

  it('PATCHes the resolution preset to the project settings API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, exportSettings: { resolutionPreset: '720x1280' } })
    )
    await expect(
      updateExportResolution('project-1', '720x1280', fetcher)
    ).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exportSettings: { resolutionPreset: '720x1280' } }),
    })
  })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
