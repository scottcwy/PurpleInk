import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'

/** 与服务端 titleSchema 同口径，先在客户端拦住明显非法输入。 */
export const PROJECT_TITLE_MAX_LENGTH = 200

export function validateProjectTitle(input: string): string | null {
  const title = input.trim()
  if (!title) return '标题不能为空'
  if (title.length > PROJECT_TITLE_MAX_LENGTH) {
    return `标题不能超过 ${PROJECT_TITLE_MAX_LENGTH} 字`
  }
  return null
}

export async function renameProjectRequest(
  projectId: string,
  title: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(projectUrl(projectId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const result = await readResult(response, '项目重命名失败，请稍后重试')
  const project = result.project
  const renamed =
    project && typeof project === 'object' && !Array.isArray(project)
      ? (project as Record<string, unknown>).title
      : undefined
  return typeof renamed === 'string' ? renamed : title
}

export async function deleteProjectRequest(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(projectUrl(projectId), { method: 'DELETE' })
  await readResult(response, '项目删除失败，请稍后重试')
}

function projectUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`
}

/** 401 交给 useRequireLogin；其余失败只透出服务端给的类别文案。 */
async function readResult(
  response: Response,
  fallback: string,
): Promise<Record<string, unknown>> {
  throwIfUnauthenticated(response)
  const body: unknown = await response.json().catch(() => null)
  const result =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : fallback)
  }
  return result
}
