import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { measureAudio, type MeasuredAudio } from '@/features/audio/measure'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import {
  createProjectWithSource,
  ProjectCreationIdempotencyError,
  type CreatedProject,
  type CreateProjectWithSourceInput,
  type ProjectCreationDependencies,
} from './project-creation'
import {
  parseProjectSourcePayload,
  PROJECT_SOURCE_SCHEMA_VERSION,
  type ProjectSourcePayload,
} from './project-source'
import {
  normalizeProjectVisualStyle,
  PROJECT_VISUAL_STYLE_FORM_FIELDS,
  projectVisualStyleRequestShape,
  readProjectVisualStyleFormData,
} from './project-visual-style'

export const MAX_PROJECT_AUDIO_BYTES = 100 * 1024 * 1024
export const MAX_PROJECT_AUDIO_DURATION_MS = 30 * 60 * 1000

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
const legacyScriptSchema = jsonScriptSchema
  .omit({ kind: true })
  .strict()
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

type ProjectCreator = (
  input: CreateProjectWithSourceInput,
  dependencies?: ProjectCreationDependencies,
) => Promise<CreatedProject>

export interface ProjectCreateRequestDependencies {
  storage?: Pick<StorageAdapter, 'put' | 'delete'>
  measureAudio?: (bytes: Buffer) => Promise<MeasuredAudio>
  createProject?: ProjectCreator
  getWorkspaceId?: () => string
  createId?: () => string
  database?: ProjectCreationDependencies['database']
}

export class ProjectCreateInputError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_PROJECT_INPUT',
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'ProjectCreateInputError'
  }
}

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
    return createFromAudioForm(request, dependencies)
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
    if (raw.kind === 'website') {
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

    const input =
      raw.kind === 'script'
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

async function createFromAudioForm(
  request: Request,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const form = await request.formData().catch(() => {
    throw new ProjectCreateInputError('录音上传表单无效')
  })
  assertAudioFormShape(form)
  const file = form.get('file')
  if (!isUploadedFile(file)) {
    throw new ProjectCreateInputError('请选择 MP3 或 WAV 录音文件')
  }
  if (file.size <= 0) throw new ProjectCreateInputError('录音文件不能为空')
  if (file.size > MAX_PROJECT_AUDIO_BYTES) {
    throw new ProjectCreateInputError('录音文件不能超过 100 MiB')
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length <= 0 || bytes.length > MAX_PROJECT_AUDIO_BYTES) {
    throw new ProjectCreateInputError('录音文件大小不符合要求')
  }
  const measured = await safelyMeasureAudio(
    bytes,
    dependencies.measureAudio ?? measureAudio,
  )
  if (measured.durationMs > MAX_PROJECT_AUDIO_DURATION_MS) {
    throw new ProjectCreateInputError('录音时长不能超过 30 分钟')
  }

  const workspaceId = uuidSchema.parse(
    (dependencies.getWorkspaceId ?? currentWorkspaceId)(),
  )
  const createId = dependencies.createId ?? randomUUID
  const projectId = uuidSchema.parse(createId())
  const sourceFingerprint = sha256(bytes)
  const fileName = safeFileName(file.name)
  const mimeType = measured.container === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  const storageKey =
    `project-sources/${workspaceId}/${projectId}/` +
    `${sourceFingerprint}.${measured.container}`
  const source = parseProjectSourcePayload({
    schemaVersion: PROJECT_SOURCE_SCHEMA_VERSION,
    kind: 'audio',
    storageKey,
    fileName,
    mimeType,
    container: measured.container,
    sizeBytes: bytes.length,
    durationMs: Math.max(1, Math.round(measured.durationMs)),
    sampleRate: measured.sampleRateHz,
    sampleCount: measured.sampleCount,
    visualTheme: readAudioVisualTheme(form),
    ...readProjectVisualStyleFormData(
      form,
      () => new ProjectCreateInputError('视觉风格无效'),
    ),
  })
  const title = readAudioTitle(form) ?? titleFromAudioFile(fileName)
  const storage = dependencies.storage ?? defaultStorage

  let writeAttempted = false
  try {
    writeAttempted = true
    await storage.put(storageKey, bytes)
    return await createFromCanonicalSource(
      { projectId, title, source, sourceFingerprint },
      {
        ...dependencies,
        getWorkspaceId: () => workspaceId,
        createId,
      },
    )
  } catch (error) {
    if (writeAttempted) await storage.delete(storageKey).catch(() => undefined)
    throw error
  }
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

function assertAudioFormShape(form: FormData): void {
  const allowed = new Set([
    'kind',
    'file',
    'title',
    'visualTheme',
    ...PROJECT_VISUAL_STYLE_FORM_FIELDS,
  ])
  for (const key of form.keys()) {
    if (!allowed.has(key) || form.getAll(key).length !== 1) {
      throw new ProjectCreateInputError('录音上传表单包含未支持的字段')
    }
  }
  if (form.get('kind') !== 'audio') {
    throw new ProjectCreateInputError('录音上传表单的 kind 必须是 audio')
  }
}

function readAudioVisualTheme(form: FormData): 'dark' | 'light' {
  const result = visualThemeSchema.safeParse(form.get('visualTheme') ?? undefined)
  if (!result.success) throw new ProjectCreateInputError('视觉主题无效')
  return result.data
}

function readAudioTitle(form: FormData): string | undefined {
  const raw = form.get('title')
  if (raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw new ProjectCreateInputError('项目标题无效')
  const result = optionalTitleSchema.safeParse(raw)
  if (!result.success) throw new ProjectCreateInputError('项目标题无效')
  return result.data
}

async function safelyMeasureAudio(
  bytes: Buffer,
  measure: (value: Buffer) => Promise<MeasuredAudio>,
): Promise<MeasuredAudio> {
  try {
    const result = await measure(bytes)
    if (
      !Number.isInteger(result.sampleCount) ||
      result.sampleCount <= 0 ||
      !Number.isInteger(result.sampleRateHz) ||
      result.sampleRateHz < 8_000 ||
      result.sampleRateHz > 192_000 ||
      !Number.isFinite(result.durationMs) ||
      result.durationMs <= 0 ||
      (result.container !== 'mp3' && result.container !== 'wav')
    ) {
      throw new Error('invalid measured audio')
    }
    return result
  } catch {
    throw new ProjectCreateInputError('无法读取录音，请上传有效的 MP3 或 WAV 文件')
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value !== 'string' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  )
}

function safeFileName(value: string): string {
  const fileName = value.trim()
  if (
    fileName.length < 1 ||
    fileName.length > 255 ||
    /[\\/\u0000-\u001f]/u.test(fileName)
  ) {
    throw new ProjectCreateInputError('录音文件名无效')
  }
  return fileName
}

function titleFromAudioFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim()
  return withoutExtension || '录音转视频'
}

function titleFromWebsite(value: string): string {
  return `网站介绍 · ${new URL(value).hostname}`
}

function fingerprintCanonicalSource(source: ProjectSourcePayload): string {
  return sha256(Buffer.from(JSON.stringify(source), 'utf8'))
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
