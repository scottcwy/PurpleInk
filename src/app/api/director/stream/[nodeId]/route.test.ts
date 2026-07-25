import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamBus } from '@/lib/stream/stream-bus'
import { GET } from './route'

const { getNodeStreamContext, getLatestArtifact, readArtifact } = vi.hoisted(() => ({
  getNodeStreamContext: vi.fn(),
  getLatestArtifact: vi.fn(),
  readArtifact: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/canvas', () => ({ getNodeStreamContext }))
vi.mock('@/features/artifacts', () => ({ getLatestArtifact, readArtifact }))

async function readSse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('响应无流式 body')
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

function get(nodeId: string, url: string): Promise<Response> {
  return GET(new Request(url), { params: Promise.resolve({ nodeId }) })
}

describe('GET /api/director/stream/[nodeId]', () => {
  afterEach(() => vi.clearAllMocks())

  it('缺少 projectId 返回 400', async () => {
    const res = await get('node-1', 'http://x/api/director/stream/node-1')
    expect(res.status).toBe(400)
  })

  it('节点不属于项目返回 404', async () => {
    getNodeStreamContext.mockReturnValue(null)
    const res = await get('node-1', 'http://x/api/director/stream/node-1?projectId=p')
    expect(res.status).toBe(404)
  })

  it('活跃流转发 snapshot 并在 done 时关闭', async () => {
    getNodeStreamContext.mockReturnValue({ status: 'running' })
    streamBus.publish('p:node-1', '你好')
    streamBus.markDone('p:node-1')

    const body = await readSse(await get('node-1', 'http://x/api/director/stream/node-1?projectId=p'))
    expect(body).toContain('event: snapshot')
    expect(body).toContain('你好')
    expect(body).toContain('event: done')
  })

  it('markError 转发 event:error', async () => {
    getNodeStreamContext.mockReturnValue({ status: 'running' })
    streamBus.publish('p:node-err', '部分')
    streamBus.markError('p:node-err', { stage: 'INGEST', message: '模型失败' })

    const body = await readSse(
      await get('node-err', 'http://x/api/director/stream/node-err?projectId=p')
    )
    expect(body).toContain('event: error')
    expect(body).toContain('模型失败')
  })

  it('无活跃流时回放持久化日志', async () => {
    getNodeStreamContext.mockReturnValue({ status: 'success' })
    getLatestArtifact.mockReturnValue({
      id: 'a1',
      projectId: 'p',
      nodeId: 'node-2',
      kind: 'director-stream-log',
      contentHash: null,
    })
    readArtifact.mockResolvedValue({ descriptor: {}, bytes: Buffer.from('已持久化日志') })

    const body = await readSse(await get('node-2', 'http://x/api/director/stream/node-2?projectId=p'))
    expect(getLatestArtifact).toHaveBeenCalledWith('p', 'node-2', 'director-stream-log')
    expect(body).toContain('event: snapshot')
    expect(body).toContain('已持久化日志')
    expect(body).toContain('event: done')
  })

  it('终态节点存在残留非 done 空 entry 时合并回放持久化日志（split-brain 后遗症）', async () => {
    getNodeStreamContext.mockReturnValue({ status: 'success' })
    getLatestArtifact.mockReturnValue({
      id: 'a2',
      projectId: 'p',
      nodeId: 'node-3',
      kind: 'director-stream-log',
      contentHash: null,
    })
    readArtifact.mockResolvedValue({ descriptor: {}, bytes: Buffer.from('回放全文') })
    // 构造残留非 done 空 entry（模拟 split-brain 后遗症 / 竞态）：publish 后 reset。
    streamBus.publish('p:node-3', 'x')
    streamBus.reset('p:node-3')

    const body = await readSse(
      await get('node-3', 'http://x/api/director/stream/node-3?projectId=p')
    )
    expect(getLatestArtifact).toHaveBeenCalledWith('p', 'node-3', 'director-stream-log')
    expect(body).toContain('event: snapshot')
    expect(body).toContain('回放全文')
    expect(body).toContain('event: done')
  })
})
