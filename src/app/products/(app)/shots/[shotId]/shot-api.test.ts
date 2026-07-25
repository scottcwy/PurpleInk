import { describe, expect, it, vi } from 'vitest'
import {
  activeThumbIndex,
  fetchThumbnails,
  formatTimecode,
  renderShotAndWait,
  stepFrame,
} from './shot-api'

describe('renderShotAndWait', () => {
  it('starts one render and polls until the mp4 artifact is available', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, jobId: 'job-1' }))
      .mockResolvedValueOnce(json({ ok: true, job: { status: 'running' } }))
      .mockResolvedValueOnce(
        json({
          ok: true,
          job: { status: 'done' },
          artifactUrl: '/api/artifacts/a-1?projectId=p-1',
        })
      )
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(renderShotAndWait('p-1', 'n-1', fetcher, wait)).resolves.toEqual({
      status: 'done',
      artifactUrl: '/api/artifacts/a-1?projectId=p-1',
    })
    expect(wait).toHaveBeenCalledOnce()
  })
})

describe('fetchThumbnails', () => {
  it('maps the endpoint payload to fraction/url pairs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        ok: true,
        thumbnails: [
          { fraction: 0, url: '/api/artifacts/a-0?projectId=p-1' },
          { fraction: 1, url: '/api/artifacts/a-1?projectId=p-1' },
        ],
      }),
    )
    await expect(fetchThumbnails('p-1', 'n-1', fetcher)).resolves.toEqual([
      { fraction: 0, url: '/api/artifacts/a-0?projectId=p-1' },
      { fraction: 1, url: '/api/artifacts/a-1?projectId=p-1' },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      '/api/render/thumbnails?projectId=p-1&nodeId=n-1',
    )
  })

  it('throws with the server message on a non-2xx response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: false, error: '该分镜尚未渲染成功' }, 409))
    await expect(fetchThumbnails('p-1', 'n-1', fetcher)).rejects.toThrow(
      '该分镜尚未渲染成功',
    )
  })
})

describe('formatTimecode', () => {
  it('formats seconds as mm:ss and clamps invalid input to 00:00', () => {
    expect(formatTimecode(0)).toBe('00:00')
    expect(formatTimecode(9)).toBe('00:09')
    expect(formatTimecode(75)).toBe('01:15')
    expect(formatTimecode(Number.NaN)).toBe('00:00')
    expect(formatTimecode(-3)).toBe('00:00')
  })
})

describe('stepFrame', () => {
  it('steps by whole frames and clamps to [0, duration]', () => {
    expect(stepFrame(1, 1, 30, 8)).toBeCloseTo(1 + 1 / 30)
    expect(stepFrame(0, -1, 30, 8)).toBe(0)
    expect(stepFrame(8, 1, 30, 8)).toBe(8)
  })

  it('returns the current time unchanged when fps is invalid', () => {
    expect(stepFrame(2, 1, 0, 8)).toBe(2)
    expect(stepFrame(2, 1, Number.NaN, 8)).toBe(2)
  })
})

describe('activeThumbIndex', () => {
  it('maps playback position to the nearest thumbnail cell', () => {
    expect(activeThumbIndex(0, 7, 8)).toBe(0)
    expect(activeThumbIndex(7, 7, 8)).toBe(7)
    expect(activeThumbIndex(3.5, 7, 8)).toBe(4)
  })

  it('returns 0 for non-positive duration or count', () => {
    expect(activeThumbIndex(3, 0, 8)).toBe(0)
    expect(activeThumbIndex(3, 7, 0)).toBe(0)
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
