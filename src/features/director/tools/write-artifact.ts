import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { resolveCurrentAttemptId } from '@/features/artifacts'
import {
  getDb,
  LOCAL_WORKSPACE_ID,
} from '@/lib/db/client'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import { inspectDeterminism } from './check-determinism'
import { validateShotPlanValue } from './validate-shot-plan'

const validationSchema = z.enum(['non-empty', 'shot-plan', 'deterministic-html'])
const inputSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1).optional(),
    kind: z.string().min(1),
    key: z
      .string()
      .min(1)
      .refine(isSafeStorageKey, 'key 必须是存储根目录内的安全相对路径'),
    content: z.string(),
    validation: validationSchema,
  })
  .strict()

export type WriteArtifactInput = z.infer<typeof inputSchema>

export type ArtifactPrevalidation =
  | { ok: true }
  | { ok: false; errors: string[] }

interface WriteArtifactDependencies {
  storage?: StorageAdapter
  validate?: (input: WriteArtifactInput) => ArtifactPrevalidation
  resolveAttempt?: (input: {
    projectId: string
    nodeId?: string
  }) => Promise<string>
  createId?: () => string
}

export interface ArtifactCommitResult {
  id: string
  workspaceId: string
  projectId: string
  aggregateType: 'node' | 'project'
  aggregateId: string
  kind: string
  schemaVersion: 'cvc.director-artifact/v1'
  storageKey: string
  sizeBytes: number
  contentHash: string
  attemptId: string
  storageKeyAlreadyExisted: boolean
}

export class ArtifactValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`产物校验失败：${errors.join('；')}`)
    this.name = 'ArtifactValidationError'
  }
}

/**
 * 校验并写入未提交对象。artifact row 与 node 投影由 Director repository 在同一
 * Postgres 事务提交；事务失败后 repository 负责补偿本次新写对象。
 */
export async function writeValidatedArtifact(
  input: WriteArtifactInput,
  dependencies: WriteArtifactDependencies = {}
): Promise<ArtifactCommitResult> {
  const targetStorage = dependencies.storage ?? defaultStorage
  const validate = dependencies.validate ?? validateArtifact
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ArtifactValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
    )
  }
  const prevalidation = validate(parsed.data)
  if (!prevalidation.ok) {
    throw new ArtifactValidationError(prevalidation.errors)
  }

  const aggregateType = parsed.data.nodeId ? 'node' : 'project'
  const aggregateId = parsed.data.nodeId ?? parsed.data.projectId
  const attemptId = await (dependencies.resolveAttempt ?? defaultAttemptResolver)({
    projectId: parsed.data.projectId,
    nodeId: parsed.data.nodeId,
  })
  const contentHash = createHash('sha256')
    .update(parsed.data.content)
    .digest('hex')
  const storageKeyAlreadyExisted = await targetStorage.exists(parsed.data.key)
  const storageKey = await targetStorage.put(
    parsed.data.key,
    parsed.data.content
  )
  return {
    id: (dependencies.createId ?? randomUUID)(),
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: parsed.data.projectId,
    aggregateType,
    aggregateId,
    kind: parsed.data.kind,
    schemaVersion: 'cvc.director-artifact/v1',
    storageKey,
    sizeBytes: Buffer.byteLength(parsed.data.content),
    contentHash,
    attemptId,
    storageKeyAlreadyExisted,
  }
}

async function defaultAttemptResolver(input: {
  projectId: string
  nodeId?: string
}): Promise<string> {
  const database = await getDb()
  return resolveCurrentAttemptId(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: input.projectId,
    aggregateType: input.nodeId ? 'node' : 'project',
    aggregateId: input.nodeId ?? input.projectId,
  })
}

function validateArtifact(input: WriteArtifactInput): ArtifactPrevalidation {
  if (input.validation === 'non-empty') {
    return input.content.trim()
      ? { ok: true }
      : { ok: false, errors: ['产物内容不能为空'] }
  }
  if (input.validation === 'deterministic-html') {
    const inspection = inspectDeterminism(input.content)
    return inspection.ok
      ? { ok: true }
      : {
          ok: false,
          errors: inspection.violations.map(
            (violation) =>
              `${violation.ruleId}@${violation.line}: ${violation.message}`
          ),
        }
  }
  try {
    const validation = validateShotPlanValue(
      JSON.parse(input.content) as unknown
    )
    return validation.ok
      ? { ok: true }
      : { ok: false, errors: validation.errors }
  } catch {
    return { ok: false, errors: ['shot-plan 内容不是合法 JSON'] }
  }
}

function isSafeStorageKey(key: string): boolean {
  if (key.includes('\\') || key.startsWith('/') || /^[A-Za-z]:/.test(key)) {
    return false
  }
  return !key
    .split('/')
    .some((segment) => segment === '..' || segment.length === 0)
}
