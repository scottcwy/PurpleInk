import { afterEach, describe, expect, it, vi } from 'vitest'
import { statusBus } from '@/lib/stream/status-bus'
import { GET } from './route'

const { listProjects } = vi.hoisted(() => ({
  listProjects: vi.fn(),
}))

vi.mock('server-only', () => ({}))
// 会话层单独有 pg 测试覆盖；这里只验路由业务分支，直接以假会话放行。
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: unknown) => Promise<Response>) =>
    handler({
      userId: 'user-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
      name: '测试用户',
      workspaceName: '测试工作区',
      sessionId: 'session-1',
    }),
}))
vi.mock('@/features/canvas', () => ({ listProjects }))

/** 读取到累计文本满足断言条件即止；项目流不会自行关闭，由调用方 abort。 */
async function readSseUntil(
  response: Response,
  predicate: (text: string) => boolean,
  timeoutMs = 1_000
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('响应无流式 body')
  const decoder = new TextDecoder()
  let out = ''
  const deadline = Date.now() + timeoutMs
  while (!predicate(out)) {
    if (Date.now() > deadline) throw new Error(`SSE 等待超时，已收到：${out}`)
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  reader.releaseLock()
  return out
}

function open(projectId: string): { response: Promise<Response>; abort: () => void } {
  const controller = new AbortController()
  const request = new Request(
    `http://x/api/director/stream/project/${projectId}`,
    { signal: controller.signal }
  )
  return {
    response: GET(request, { params: Promise.resolve({ projectId }) }),
    abort: () => controller.abort(),
  }
}

describe('GET /api/director/stream/project/[projectId]', () => {
  afterEach(() => vi.clearAllMocks())

  it('项目不存在返回 404', async () => {
    listProjects.mockResolvedValue([{ id: 'other' }])
    const { response } = open('missing')
    expect((await response).status).toBe(404)
  })

  it('连接先收到 snapshot（含已发生状态与 seq 水位）', async () => {
    listProjects.mockResolvedValue([{ id: 'proj-snap' }])
    statusBus.publishStatus('proj-snap', 'n1', 'running')

    const { response, abort } = open('proj-snap')
    const body = await readSseUntil(await response, (text) =>
      text.includes('event: snapshot')
    )
    abort()

    expect(body).toContain('event: snapshot')
    expect(body).toContain('"n1":"running"')
    expect(body).toContain('"seq":1')
  })

  it('转发 node-status 与 topology 事件', async () => {
    listProjects.mockResolvedValue([{ id: 'proj-live' }])

    const { response, abort } = open('proj-live')
    const res = await response
    statusBus.publishStatus('proj-live', 'n2', 'pending')
    statusBus.publishTopology('proj-live')
    const body = await readSseUntil(res, (text) => text.includes('event: topology'))
    abort()

    expect(body).toContain('event: node-status')
    expect(body).toContain('"nodeId":"n2"')
    expect(body).toContain('"status":"pending"')
    expect(body).toContain('event: topology')
  })

  it('abort 后退订：后续发布不再进入流', async () => {
    listProjects.mockResolvedValue([{ id: 'proj-abort' }])
    const unsubscribe = vi.fn()
    const realSubscribe = statusBus.subscribe.bind(statusBus)
    const spy = vi.spyOn(statusBus, 'subscribe').mockImplementation(
      (projectId, listener) => {
        const real = realSubscribe(projectId, listener)
        return () => {
          unsubscribe()
          real()
        }
      }
    )

    const { response, abort } = open('proj-abort')
    const res = await response
    await readSseUntil(res, (text) => text.includes('event: snapshot'))
    abort()
    // abort 监听是同步 finish；退订必须已发生。
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // 流已关闭：读取立即结束，且不因后续发布产生新帧。
    statusBus.publishStatus('proj-abort', 'n9', 'running')
    const reader = res.body?.getReader()
    const tail = await reader?.read()
    expect(tail?.done).toBe(true)
    spy.mockRestore()
  })
})
