import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { measureAudio, type MeasuredAudio } from '@/features/audio/measure'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { storage as defaultStorage } from '@/lib/storage'
import {
  createProjectWithSource,
  ProjectCreationIdempotencyError,
  type CreatedProject,
  type CreateProjectWithSourceInput,
} from './project-creation'
import { fingerprintProjectCreationRequest } from './project-creation-fingerprint'
import {
  MAX_PROJECT_AUDIO_BYTES,
  MAX_PROJECT_AUDIO_DURATION_MS,
  ProjectCreateInputError,
  type ProjectCreateRequestDependencies,
} from './project-create-contract'
import {
  parseProjectSourcePayload,
  PROJECT_SOURCE_SCHEMA_VERSION,
} from './project-source'
import {
  PROJECT_VISUAL_STYLE_FORM_FIELDS,
  readProjectVisualStyleFormData,
} from './project-visual-style'
import {
  cleanupProjectSourceUpload,
  type ProjectSourceCleanupRequest,
} from './project-source-cleanup'

const uuidSchema = z.string().uuid()
const optionalTitleSchema = z.string().trim().min(1).max(200).optional()
const visualThemeSchema = z.enum(['dark', 'light']).default('dark')

export async function createProjectFromAudioForm(
  request: Request,
  dependencies: ProjectCreateRequestDependencies,
): Promise<CreatedProject> {
  const form = await request.formData().catch(() => {
    throw new ProjectCreateInputError('录音上传表单无效')
  })
  assertAudioFormShape(form)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || !uuidSchema.safeParse(idempotencyKey).success) {
    throw new ProjectCreateInputError(
      '录音项目创建请求缺少有效的 Idempotency-Key',
    )
  }
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
    `project-sources/${workspaceId}/${projectId}/`
    + `${sourceFingerprint}.${measured.container}`
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
  let result: CreatedProject
  try {
    writeAttempted = true
    await storage.put(storageKey, bytes)
    result = await createFromCanonicalSource(
      {
        projectId,
        title,
        source,
        sourceFingerprint,
        idempotency: {
          key: idempotencyKey,
          requestFingerprint: fingerprintProjectCreationRequest({
            title,
            source,
            sourceFingerprint,
          }),
        },
      },
      {
        ...dependencies,
        getWorkspaceId: () => workspaceId,
        createId,
      },
    )
  } catch (error) {
    if (writeAttempted) {
      try {
        await cleanupUploadedSource(
          { workspaceId, storageKey, reason: 'creation-failed' },
          dependencies,
        )
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          '录音项目创建失败且上传清理登记失败',
        )
      }
    }
    if (error instanceof ProjectCreationIdempotencyError) {
      throw new ProjectCreateInputError(
        '同一创建请求标识已用于其他项目参数',
        error.code,
        409,
      )
    }
    throw error
  }
  if (result.reused) {
    await cleanupUploadedSource(
      { workspaceId, storageKey, reason: 'duplicate-upload' },
      dependencies,
    )
  }
  return result
}

async function cleanupUploadedSource(
  request: ProjectSourceCleanupRequest,
  dependencies: ProjectCreateRequestDependencies,
): Promise<void> {
  const storage = dependencies.storage ?? defaultStorage
  const cleanup = dependencies.cleanupSourceUpload
    ?? ((input: ProjectSourceCleanupRequest) =>
      cleanupProjectSourceUpload(input, {
        database: dependencies.database,
        storage,
      }))
  await cleanup(request)
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
      !Number.isInteger(result.sampleCount)
      || result.sampleCount <= 0
      || !Number.isInteger(result.sampleRateHz)
      || result.sampleRateHz < 8_000
      || result.sampleRateHz > 192_000
      || !Number.isFinite(result.durationMs)
      || result.durationMs <= 0
      || (result.container !== 'mp3' && result.container !== 'wav')
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
    value !== null
    && typeof value !== 'string'
    && typeof value.name === 'string'
    && typeof value.size === 'number'
    && typeof value.arrayBuffer === 'function'
  )
}

function safeFileName(value: string): string {
  const fileName = value.trim()
  if (
    fileName.length < 1
    || fileName.length > 255
    || /[\\/\u0000-\u001f]/u.test(fileName)
  ) {
    throw new ProjectCreateInputError('录音文件名无效')
  }
  return fileName
}

function titleFromAudioFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim()
  return withoutExtension || '录音转视频'
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
