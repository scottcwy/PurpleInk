export interface ShotJobResult {
  status: 'done' | 'failed'
  artifactUrl?: string
  error?: string
}

export async function renderShotAndWait(
  projectId: string,
  nodeId: string,
  fetcher: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = delay
): Promise<ShotJobResult> {
  const started = await fetcher('/api/render', request({ projectId, nodeId }))
  const startBody = await objectBody(started)
  if (!started.ok) throw new Error(errorOf(startBody, '渲染作业入队失败'))
  const jobId = stringOf(startBody, 'jobId')

  for (;;) {
    const response = await fetcher(
      `/api/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`
    )
    const body = await objectBody(response)
    if (!response.ok) throw new Error(errorOf(body, '作业状态读取失败'))
    const job = body.job
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new Error('作业状态响应无效')
    }
    const status = (job as Record<string, unknown>).status
    if (status === 'done') {
      return {
        status,
        ...(typeof body.artifactUrl === 'string' ? { artifactUrl: body.artifactUrl } : {}),
      }
    }
    if (status === 'failed') {
      const error = (job as Record<string, unknown>).error
      return { status, ...(typeof error === 'string' ? { error } : {}) }
    }
    await wait(750)
  }
}

export interface ShotThumbnail {
  fraction: number
  url: string
}

/**
 * 拉取某分镜的 8 张静态帧缩略图（由 GET /api/render/thumbnails 按需生成 / 缓存）。
 * 只接收 artifact id 下载 URL；节点尚未渲染成功时后端会以非 2xx 报错。
 */
export async function fetchThumbnails(
  projectId: string,
  nodeId: string,
  fetcher: typeof fetch = fetch
): Promise<ShotThumbnail[]> {
  const response = await fetcher(
    `/api/render/thumbnails?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(nodeId)}`
  )
  const body = await objectBody(response)
  if (!response.ok) throw new Error(errorOf(body, '缩略图读取失败'))
  const thumbnails = body.thumbnails
  if (!Array.isArray(thumbnails)) throw new Error('缩略图响应无效')
  return thumbnails.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('缩略图响应无效')
    }
    const record = item as Record<string, unknown>
    if (typeof record.fraction !== 'number' || typeof record.url !== 'string') {
      throw new Error('缩略图响应无效')
    }
    return { fraction: record.fraction, url: record.url }
  })
}

/** 秒 → mm:ss（NaN / 负数归零），用于播放器时间戳展示。 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** 基于 fps 的整帧步进，钳制到 [0, duration]；fps 非法时原地不动。 */
export function stepFrame(
  currentTime: number,
  deltaFrames: number,
  fps: number,
  duration: number
): number {
  if (!Number.isFinite(fps) || fps <= 0) return currentTime
  const next = currentTime + deltaFrames / fps
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, next)
  return Math.min(Math.max(0, next), duration)
}

/** 当前播放位置对应的缩略图格索引（0..count-1）。 */
export function activeThumbIndex(
  currentTime: number,
  duration: number,
  count: number
): number {
  if (count <= 0 || !Number.isFinite(duration) || duration <= 0) return 0
  const ratio = Math.min(Math.max(currentTime / duration, 0), 1)
  return Math.round(ratio * (count - 1))
}

function request(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function objectBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('作业响应无效')
  }
  return body as Record<string, unknown>
}

function stringOf(body: Record<string, unknown>, key: string): string {
  if (typeof body[key] !== 'string') throw new Error(`作业响应缺少 ${key}`)
  return body[key]
}

function errorOf(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
