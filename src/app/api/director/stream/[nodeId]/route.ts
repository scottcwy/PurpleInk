import { getLatestArtifact, readArtifact } from '@/features/artifacts'
import { getNodeStreamContext } from '@/features/canvas'
import { streamBus, type StreamError } from '@/lib/stream/stream-bus'

export const dynamic = 'force-dynamic'

const KEEPALIVE_MS = 15_000

/** 读取某节点已持久化的流式日志（无则空串）。 */
async function readPersistedLog(projectId: string, nodeId: string): Promise<string> {
  const artifact = await getLatestArtifact(
    projectId,
    nodeId,
    'director-stream-log'
  )
  if (!artifact) return ''
  try {
    const { bytes } = await readArtifact(projectId, artifact.id)
    return bytes.toString('utf8')
  } catch {
    return ''
  }
}

/**
 * 节点阶段流式日志 SSE 通道（按 projectId:nodeId 隔离）。
 * - 有内存活跃流 / 节点运行中 → 订阅事件总线，转发 snapshot / delta / done / error。
 * - 否则（阶段已结束、刷新后）→ 回放持久化日志 + 失败时的 directorError，随即关闭。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) {
    return Response.json({ ok: false, error: '缺少 projectId' }, { status: 400 })
  }
  const { nodeId } = await params
  const context = await getNodeStreamContext(projectId, nodeId)
  if (!context) {
    return Response.json({ ok: false, error: '节点不存在或不属于该项目' }, { status: 404 })
  }

  const key = `${projectId}:${nodeId}`
  const useLive =
    streamBus.isActive(key) || context.status === 'running' || context.status === 'pending'
  // 节点已终态（非 running/pending）：live 分支若订到空快照则合并回放，兑底 split-brain 后遗症。
  const nodeSettled = context.status !== 'running' && context.status !== 'pending'
  const directorError: StreamError | undefined = context.directorError

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: (() => void) | undefined
      let keepalive: ReturnType<typeof setInterval> | undefined
      let settledReplay = false

      const send = (event: string, data: unknown): void => {
        if (closed) return
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }
      const finish = (): void => {
        if (closed) return
        closed = true
        if (keepalive) clearInterval(keepalive)
        unsubscribe?.()
        request.signal.removeEventListener('abort', finish)
        try {
          controller.close()
        } catch {
          // 已关闭，忽略。
        }
      }
      request.signal.addEventListener('abort', finish)

      if (useLive) {
        keepalive = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(`: keepalive\n\n`))
        }, KEEPALIVE_MS)
        ;(keepalive as { unref?: () => void }).unref?.()
        unsubscribe = streamBus.subscribe(key, (event) => {
          if (settledReplay) return
          if (event.type === 'snapshot') {
            // 终态节点订到空且未结束的残留快照（split-brain 后遗症 / 竞态）：
            // 服务端合并回放持久化日志全文替代空文本下发，前端无感知。
            if (event.text === '' && !event.done && nodeSettled) {
              settledReplay = true
              void readPersistedLog(projectId, nodeId).then((text) => {
                send('snapshot', {
                  text,
                  done: true,
                  error: directorError ?? null,
                  truncated: false,
                })
                if (directorError) send('error', directorError)
                else send('done', {})
                finish()
              })
              return
            }
            send('snapshot', {
              text: event.text,
              done: event.done,
              error: event.error ?? null,
              truncated: event.truncated,
            })
            if (event.done) {
              if (event.error) send('error', event.error)
              else send('done', {})
              finish()
            }
          } else if (event.type === 'delta') {
            send('delta', { text: event.text })
          } else if (event.type === 'done') {
            send('done', {})
            finish()
          } else {
            send('error', event.error)
            finish()
          }
        })
        // 若 snapshot 同步触发了 finish（订阅时流已结束），补退订避免悬挂监听。
        if (closed) unsubscribe()
        return
      }

      // 回放路径：读持久化日志，一次性发出快照 + 终态，随即关闭。
      void readPersistedLog(projectId, nodeId).then((text) => {
        send('snapshot', {
          text,
          done: true,
          error: directorError ?? null,
          truncated: false,
        })
        if (directorError) send('error', directorError)
        else send('done', {})
        finish()
      })
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
