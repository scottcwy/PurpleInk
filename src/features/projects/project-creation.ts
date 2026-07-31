import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  projectCreationRequests,
  projects,
} from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { DEFAULT_EXPORT_SETTINGS } from '@/features/canvas/export-settings'
import type { Project } from '@/features/canvas/types'
import {
  parseProjectSourcePayload,
  type ProjectSourcePayload,
} from './project-source'
import { PostgresProjectSourceRepository } from './project-source-repository'
import { buildProjectTopology } from './project-topology'

const uuidSchema = z.string().uuid()
const titleSchema = z.string().trim().min(1, '标题不能为空').max(200, '标题不能超过 200 字')
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export interface CreateProjectWithSourceInput {
  /** 仅供服务端适配器预分配对象键；不会直接读取客户端字段。 */
  projectId?: string
  title: string
  source: ProjectSourcePayload
  sourceFingerprint: string
  idempotency?: {
    key: string
    requestFingerprint: string
  }
}

export interface ProjectCreationDependencies {
  database?: Db
  workspaceId?: string
  createId?: () => string
}

export interface CreatedProject {
  project: Project
  entryNodeId: string
  reused: boolean
}

export class ProjectCreationIdempotencyError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED'

  constructor() {
    super('同一创建请求标识已用于其他项目参数')
    this.name = 'ProjectCreationIdempotencyError'
  }
}

/**
 * 三种来源共用的原子创建边界：project、project_source 与初始 DAG 要么全部成功，
 * 要么全部回滚。上传字节的写入与补偿由请求适配器负责，不进入数据库事务。
 */
export async function createProjectWithSource(
  input: CreateProjectWithSourceInput,
  dependencies: ProjectCreationDependencies = {},
): Promise<CreatedProject> {
  const source = parseProjectSourcePayload(input.source)
  const title = titleSchema.parse(input.title)
  const sourceFingerprint = fingerprintSchema.parse(input.sourceFingerprint)
  const database = dependencies.database ?? (await getDb())
  const workspaceId = uuidSchema.parse(
    dependencies.workspaceId ?? currentWorkspaceId(),
  )
  const createId = dependencies.createId ?? randomUUID
  const nextId = () => uuidSchema.parse(createId())
  const projectId = input.projectId
    ? uuidSchema.parse(input.projectId)
    : nextId()
  const topology = buildProjectTopology(source)
  const idempotency = input.idempotency
    ? {
        key: uuidSchema.parse(input.idempotency.key),
        requestFingerprint: fingerprintSchema.parse(
          input.idempotency.requestFingerprint,
        ),
      }
    : undefined

  if (idempotency) {
    const existing = await readExistingCreation(database, workspaceId, idempotency.key)
    if (existing) {
      return reuseExistingCreation(existing, idempotency.requestFingerprint)
    }
  }

  try {
    return await withTransaction(database, async (transaction) => {
    const [project] = await transaction
      .insert(projects)
      .values({
        workspaceId,
        id: projectId,
        title,
        script: source.kind === 'script' ? source.script : '',
        workflowKind: source.kind,
        workflowVersion: activeWorkflowVersionFor(source.kind),
        exportSettings: {
          schemaVersion: 1,
          settings: DEFAULT_EXPORT_SETTINGS,
        },
      })
      .returning({
        id: projects.id,
        kind: projects.workflowKind,
        title: projects.title,
        script: projects.script,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
    if (!project) throw new Error('项目创建失败')

    await new PostgresProjectSourceRepository(transaction, workspaceId).create({
      projectId,
      sourcePayload: source,
      sourceFingerprint,
    })

    const nodeRows = topology.nodes.map((definition) => ({
      workspaceId,
      id: nextId(),
      projectId,
      type: definition.type,
      stage: definition.stage,
      logicalKey: definition.logicalKey,
      data: definition.data,
    }))
    await transaction.insert(canvasNodes).values(nodeRows)

    const nodeIds = new Map(
      nodeRows.map((node) => [node.logicalKey, node.id] as const),
    )
    const entryNodeId = requiredNodeId(nodeIds, topology.entryLogicalKey)
    const edgeRows = topology.edges.map((definition) => ({
      workspaceId,
      id: nextId(),
      projectId,
      source: requiredNodeId(nodeIds, definition.sourceLogicalKey),
      target: requiredNodeId(nodeIds, definition.targetLogicalKey),
    }))
    if (edgeRows.length > 0) {
      await transaction.insert(canvasEdges).values(edgeRows)
    }
    if (idempotency) {
      await transaction.insert(projectCreationRequests).values({
        workspaceId,
        idempotencyKey: idempotency.key,
        requestFingerprint: idempotency.requestFingerprint,
        projectId,
        entryNodeId,
      })
    }
    return { project, entryNodeId, reused: false }
    })
  } catch (error) {
    if (!idempotency || !isCreationKeyCollision(error)) throw error
    const existing = await readExistingCreation(database, workspaceId, idempotency.key)
    if (!existing) throw error
    return reuseExistingCreation(existing, idempotency.requestFingerprint)
  }
}

async function readExistingCreation(
  transaction: TransactionContext | Db,
  workspaceId: string,
  idempotencyKey: string,
) {
  const [row] = await transaction
    .select({
      requestFingerprint: projectCreationRequests.requestFingerprint,
      entryNodeId: projectCreationRequests.entryNodeId,
      id: projects.id,
      kind: projects.workflowKind,
      title: projects.title,
      script: projects.script,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projectCreationRequests)
    .innerJoin(projects, and(
      eq(projects.workspaceId, projectCreationRequests.workspaceId),
      eq(projects.id, projectCreationRequests.projectId),
    ))
    .where(and(
      eq(projectCreationRequests.workspaceId, workspaceId),
      eq(projectCreationRequests.idempotencyKey, idempotencyKey),
    ))
    .limit(1)
  if (!row) return null
  return {
    requestFingerprint: row.requestFingerprint,
    entryNodeId: row.entryNodeId,
    project: {
      id: row.id,
      kind: row.kind,
      title: row.title,
      script: row.script,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  }
}

function reuseExistingCreation(
  existing: NonNullable<Awaited<ReturnType<typeof readExistingCreation>>>,
  requestFingerprint: string,
): CreatedProject {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new ProjectCreationIdempotencyError()
  }
  return {
    project: existing.project,
    entryNodeId: existing.entryNodeId,
    reused: true,
  }
}

function isCreationKeyCollision(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== 'object') return false
    const record = candidate as {
      code?: unknown
      constraint_name?: unknown
      cause?: unknown
    }
    if (
      record.code === '23505'
      && record.constraint_name === 'project_creation_requests_pkey'
    ) {
      return true
    }
    candidate = record.cause
  }
  return false
}

function requiredNodeId(nodes: ReadonlyMap<string, string>, logicalKey: string): string {
  const id = nodes.get(logicalKey)
  if (!id) throw new Error(`项目拓扑引用了不存在的节点：${logicalKey}`)
  return id
}
