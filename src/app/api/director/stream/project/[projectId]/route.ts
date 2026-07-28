import { withApiSession } from '@/features/auth/api-session'
import { listProjects } from '@/features/canvas'
import { statusBus } from '@/lib/stream/status-bus'

export const dynamic = 'force-dynamic'

const KEEPALIVE_MS = 15_000

/**
 * 项目级节点状态 SSE 通道（按 projectId 隔离）。
 *
 * 订阅 status-bus：先转发 snapshot（每节点最新状态 + seq 水位），
 * 之后转发 node-status / topology 事件。状态真值在 DB（页面 props 承担基线），
 * 本通道只负责推增量，因此无持久化回放分支；连接生命周期归客户端
 * （全终态时由 hook 主动断开），服务端不主动 close。
 *
 * 会话：EventSource 同源自动携带 cookie；未登录回 401，客户端 hook 按
 * connection-error 转轮询兜底。流回调只碰 statusBus（无 DB），数据查询
 * （listProjects）全部在 handler await 期内，已被归属上下文覆盖。
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  return withApiSession(() => handleGet(request, params))
}

async function handleGet(
  request: Request,
  params: Promise<{ projectId: string }>
): Promise<Response> {
  const { projectId } = await params
  const projects = await listProjects()
  if (!projects.some((project) => project.id === projectId)) {
    return Response.json({ ok: false, error: '项目不存在' }, { status: 404 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const send = (event: string, data: unknown): void => {
        if (closed) return
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      // 订阅时同步回放 snapshot，帧由 controller 缓冲，早于 keepalive/abort 注册无害。
      const unsubscribe = statusBus.subscribe(projectId, (event) => {
        if (event.type === 'snapshot') {
          send('snapshot', { seq: event.seq, statuses: event.statuses })
        } else if (event.type === 'node-status') {
          send('node-status', {
            seq: event.seq,
            nodeId: event.nodeId,
            status: event.status,
          })
        } else {
          send('topology', { seq: event.seq })
        }
      })

      const keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: keepalive\n\n`))
      }, KEEPALIVE_MS)
      ;(keepalive as { unref?: () => void }).unref?.()

      const finish = (): void => {
        if (closed) return
        closed = true
        clearInterval(keepalive)
        unsubscribe()
        request.signal.removeEventListener('abort', finish)
        try {
          controller.close()
        } catch {
          // 已关闭，忽略。
        }
      }
      request.signal.addEventListener('abort', finish)
      // 连接建立前已 abort（竞态）：立即收尾，避免悬挂监听。
      if (request.signal.aborted) finish()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
