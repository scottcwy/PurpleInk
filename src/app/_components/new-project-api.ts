export async function createProjectAndStartIngest(
  input: { title: string; script: string },
  fetcher: typeof fetch = fetch
): Promise<{ projectId: string }> {
  const created = await fetcher('/api/projects', jsonRequest(input))
  const creation = await readJson(created)
  if (!created.ok) throw new Error(readError(creation, '请稍后重试'))
  const projectId = readString(creation, 'project', 'id')
  const nodeId = readString(creation, 'ingestNodeId')
  const queued = await fetcher(
    '/api/director/stage',
    jsonRequest({ projectId, nodeId, stage: 'INGEST' })
  )
  const queueResult = await readJson(queued)
  if (!queued.ok) throw new Error(readError(queueResult, '分镜触发失败，可在画布重试'))
  return { projectId }
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请稍后重试')
  }
  return value as Record<string, unknown>
}

function readString(value: Record<string, unknown>, key: string, child?: string): string {
  const parent = value[key]
  const candidate =
    child && parent && typeof parent === 'object'
      ? (parent as Record<string, unknown>)[child]
      : parent
  if (typeof candidate !== 'string' || !candidate) throw new Error('请稍后重试')
  return candidate
}

function readError(value: Record<string, unknown>, fallback: string): string {
  return typeof value.error === 'string' ? value.error : fallback
}
