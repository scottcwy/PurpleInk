import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { createProjectFromAudioForm } from './project-create-audio'
import {
  ProjectCreateInputError,
  type ProjectCreateRequestDependencies,
} from './project-create-contract'
import {
  createProjectWithSource,
  ProjectCreationIdempotencyError,
  type CreatedProject,
  type CreateProjectWithSourceInput,
} from './project-creation'
import {
  parseProjectSourcePayload,
  PROJECT_SOURCE_SCHEMA_VERSION,
  type ProjectSourcePayload,
} from './project-source'
import {
  normalizeProjectVisualStyle,
  projectVisualStyleRequestShape,
} from './project-visual-style'

export {
  MAX_PROJECT_AUDIO_BYTES,
  MAX_PROJECT_AUDIO_DURATION_MS,
  ProjectCreateInputError,
} from './project-create-contract'
export type { ProjectCreateRequestDependencies } from './project-create-contract'

const titleSchema = z.string().trim().min(1).max(200)
const optionalTitleSchema = z.string().trim().min(1).max(200).optional()
const visualThemeSchema = z.enum(['dark', 'light']).default('dark')
const jsonScriptSchema = z
  .object({
    kind: z.literal('script'),
    title: titleSchema,
    script: z.string().trim().min(1).max(200_000),
    visualTheme: visualThemeSchema,
    ...projectVisualStyleRequestShape,
  })
  .strict()
const legacyScriptSchema = jsonScriptSchema.omit({ kind: true }).strict()
const jsonWebsiteSchema = z
  .object({
    kind: z.literal('website'),
    title: optionalTitleSchema,
    url: z.string().trim().min(1).max(2_048),
    durationSec: z.number().int().min(5).max(120).default(24),
    quality: z.enum(['draft', 'standard', 'high']).default('standard'),
    visualTheme: visualThemeSchema,
    ...projectVisualStyleRequestShape,
  })
  .strict()
const uuidSchema = z.string().uuid()

/**
 * HTTP Request 的唯一项目创建适配器。它只接受 JSON script/website，或
 * multipart audio；客户端不能注入 storageKey、指纹、projectId 或工作流版本。
 */
export async function createProjectFromRequest(
  request: Request,
  dependencies: ProjectCreateRequestDependencies = {},
): Promise<CreatedProject> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.startsWith('application/json')) {
    return createFromJson(request, dependencies)
  }
  if (contentType.startsWith('multipart/form-data')) {
    return createProjectFromAudioForm(request, dependencies)
  }
  throw new ProjectCreateInputError('请求格式必须是 JSON 或录音上传表单')
}

async function createFromJson(
  request: Request,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const raw = await request.json().catch(() => {
    throw new ProjectCreateInputError('JSON 请求体无效')
  })
  if (!isRecord(raw)) throw new ProjectCreateInputError('项目参数无效')
  if (raw.kind === 'audio') {
    throw new ProjectCreateInputError('录音项目必须通过 multipart/form-data 上传文件')
  }

  try {
    return raw.kind === 'website'
      ? await createWebsite(raw, request, dependencies)
      : await createScript(raw, dependencies)
  } catch (error) {
    if (error instanceof ProjectCreateInputError) throw error
    if (error instanceof ProjectCreationIdempotencyError) {
      throw new ProjectCreateInputError(
        '同一创建请求标识已用于其他项目参数',
        error.code,
        409,
      )
    }
    if (error instanceof z.ZodError) {
      throw new ProjectCreateInputError('项目参数不符合要求')
    }
    throw error
  }
}

async function createWebsite(
  raw: Record<string, unknown>,
  request: Request,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const input = jsonWebsiteSchema.parse(raw)
  const source = parseProjectSourcePayload({
    schemaVersion: PROJECT_SOURCE_SCHEMA_VERSION,
    kind: 'website',
    url: input.url,
    durationSec: input.durationSec,
    quality: input.quality,
    visualTheme: input.visualTheme,
    ...normalizeProjectVisualStyle(input),
  })
  if (source.kind !== 'website') throw new Error('网站来源归一化失败')
  const title = input.title ?? titleFromWebsite(source.url)
  const sourceFingerprint = fingerprintCanonicalSource(source)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || !uuidSchema.safeParse(idempotencyKey).success) {
    throw new ProjectCreateInputError(
      '网站项目创建请求缺少有效的 Idempotency-Key',
    )
  }
  return createFromCanonicalSource(
    {
      title,
      source,
      sourceFingerprint,
      idempotency: {
        key: idempotencyKey,
        requestFingerprint: fingerprintCreationRequest({
          title,
          source,
          sourceFingerprint,
        }),
      },
    },
    dependencies,
  )
}

async function createScript(
  raw: Record<string, unknown>,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const input = raw.kind === 'script'
    ? jsonScriptSchema.parse(raw)
    : legacyScriptSchema.parse(raw)
  const source = parseProjectSourcePayload({
    schemaVersion: PROJECT_SOURCE_SCHEMA_VERSION,
    kind: 'script',
    script: input.script,
    visualTheme: input.visualTheme,
    ...normalizeProjectVisualStyle(input),
  })
  return createFromCanonicalSource(
    {
      title: input.title,
      source,
      sourceFingerprint: fingerprintCanonicalSource(source),
    },
    dependencies,
  )
}

async function createFromCanonicalSource(
  input: CreateProjectWithSourceInput,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const createProject = dependencies.createProject ?? createProjectWithSource
  return createProject(input, {
    database: dependencies.database,
    workspaceId: (dependencies.getWorkspaceId ?? currentWorkspaceId)(),
    createId: dependencies.createId,
  })
}

function fingerprintCreationRequest(
  input: Pick<
    CreateProjectWithSourceInput,
    'title' | 'source' | 'sourceFingerprint'
  >,
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.title,
      input.source.kind,
      input.sourceFingerprint,
      input.source,
    ]))
    .digest('hex')
}

function titleFromWebsite(value: string): string {
  return `网站介绍 · ${new URL(value).hostname}`
}

function fingerprintCanonicalSource(source: ProjectSourcePayload): string {
  return createHash('sha256')
    .update(Buffer.from(JSON.stringify(source), 'utf8'))
    .digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
