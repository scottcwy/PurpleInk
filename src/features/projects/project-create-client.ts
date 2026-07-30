import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'
import type { ProjectVisualStyle } from './project-visual-style'

export type ProjectVisualTheme = 'dark' | 'light'
export type WebsiteVideoQuality = 'draft' | 'standard' | 'high'

type ProjectVisualPreferencesInput = {
  visualTheme: ProjectVisualTheme
  visualStyle?: ProjectVisualStyle
  customVisualStyle?: string
}

export type CreateProjectInput = ProjectVisualPreferencesInput &
  (
  | {
      kind: 'script'
      title: string
      script: string
    }
  | {
      kind: 'audio'
      title?: string
      file: File
    }
  | {
      kind: 'website'
      title?: string
      url: string
      durationSec: number
      quality: WebsiteVideoQuality
    }
  )

export class ProjectStartQuotaError extends Error {
  readonly code = 'QUOTA_EXHAUSTED'

  constructor(
    readonly resetAt: string,
    readonly billingUrl: '/products/billing',
  ) {
    super('本周期 AI 额度已用完')
    this.name = 'ProjectStartQuotaError'
  }
}

export async function createProject(
  input: CreateProjectInput,
  fetcher: typeof fetch = fetch,
  creationKey = input.kind === 'website'
    ? createProjectCreationKey()
    : undefined,
): Promise<string> {
  const response = await fetcher(
    '/api/projects',
    projectRequest(input, creationKey),
  )
  throwIfUnauthenticated(response)
  const result = await readJson(response)
  if (!response.ok) throw new Error(readError(result, '项目创建失败，请稍后重试'))
  return readString(result, 'project', 'id')
}

export async function startProject(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/start`,
    { method: 'POST' },
  )
  throwIfUnauthenticated(response)
  const result = await readJson(response)
  if (!response.ok) {
    if (isQuotaResponse(response, result)) {
      throw new ProjectStartQuotaError(result.resetAt, result.billingUrl)
    }
    throw new Error(readError(result, '工作流启动失败，可在项目画布重试'))
  }
}

export async function createProjectAndStart(
  input: CreateProjectInput,
  fetcher: typeof fetch = fetch,
): Promise<{ projectId: string }> {
  const projectId = await createProject(input, fetcher)
  await startProject(projectId, fetcher)
  return { projectId }
}

export function createProjectCreationKey(): string {
  return crypto.randomUUID()
}

function projectRequest(
  input: CreateProjectInput,
  creationKey?: string,
): RequestInit {
  if (input.kind !== 'audio') {
    return jsonRequest(input, input.kind === 'website' ? creationKey : undefined)
  }

  const form = new FormData()
  form.set('kind', input.kind)
  form.set('file', input.file)
  form.set('visualTheme', input.visualTheme)
  form.set('visualStyle', input.visualStyle ?? 'default')
  if (input.customVisualStyle) {
    form.set('customVisualStyle', input.customVisualStyle)
  }
  if (input.title?.trim()) form.set('title', input.title.trim())
  return { method: 'POST', body: form }
}

function jsonRequest(body: unknown, creationKey?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(creationKey ? { 'idempotency-key': creationKey } : {}),
    },
    body: JSON.stringify(body),
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}))
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(
  value: Record<string, unknown>,
  key: string,
  child?: string,
): string {
  const parent = value[key]
  const candidate =
    child && parent && typeof parent === 'object'
      ? (parent as Record<string, unknown>)[child]
      : parent
  if (typeof candidate !== 'string' || !candidate) {
    throw new Error('项目创建响应无效，请稍后重试')
  }
  return candidate
}

function readError(value: Record<string, unknown>, fallback: string): string {
  return typeof value.error === 'string' ? value.error : fallback
}

function isQuotaResponse(
  response: Response,
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  code: 'QUOTA_EXHAUSTED'
  resetAt: string
  billingUrl: '/products/billing'
} {
  return (
    response.status === 402 &&
    value.code === 'QUOTA_EXHAUSTED' &&
    typeof value.resetAt === 'string' &&
    value.billingUrl === '/products/billing'
  )
}
