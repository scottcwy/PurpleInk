import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  readArtifact: vi.fn(),
  artifactContentType: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/artifacts', () => mocks)

describe('GET /api/artifacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readArtifact.mockResolvedValue({
      descriptor: { kind: 'render-mp4' },
      bytes: Buffer.from('video'),
    })
    mocks.artifactContentType.mockReturnValue('video/mp4')
  })

  it('serves only the artifact resolved inside the requested project', async () => {
    const response = await GET(
      new Request('http://localhost/api/artifacts/a-1?projectId=p-1'),
      { params: Promise.resolve({ id: 'a-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(mocks.readArtifact).toHaveBeenCalledWith('p-1', 'a-1')
  })
})
