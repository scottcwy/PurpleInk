import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import {
  projectSources,
  projects,
  type VersionedPayload,
} from '@/lib/db/schema/index'
import {
  parseProjectSourcePayload,
  type ProjectSourcePayload,
  type ProjectSourceRecord,
} from './project-source'

type ProjectSourceDatabase = Pick<Db, 'insert' | 'select'>

const uuidSchema = z.string().uuid()
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export class ProjectSourceKindMismatchError extends Error {
  readonly code = 'PROJECT_SOURCE_KIND_MISMATCH'

  constructor(projectId: string) {
    super(`项目来源类型与项目工作流不一致：${projectId}`)
    this.name = 'ProjectSourceKindMismatchError'
  }
}

export interface CreateProjectSourceInput {
  projectId: string
  sourcePayload: unknown
  sourceFingerprint: string
}

/**
 * 项目来源只通过 server-only repository 读写。
 *
 * database 可以是 Db，也可以是 application service 提供的 transaction，
 * 因而项目、初始拓扑与来源记录可以由上层纳入同一原子创建边界。
 */
export class PostgresProjectSourceRepository {
  private readonly workspaceId: string

  constructor(
    private readonly database: ProjectSourceDatabase,
    workspaceId: string,
  ) {
    this.workspaceId = uuidSchema.parse(workspaceId)
  }

  async create(input: CreateProjectSourceInput): Promise<ProjectSourceRecord> {
    const projectId = uuidSchema.parse(input.projectId)
    const sourcePayload = parseProjectSourcePayload(input.sourcePayload)
    const sourceFingerprint = fingerprintSchema.parse(input.sourceFingerprint)
    await this.assertProjectKind(projectId, sourcePayload)

    const storedPayload: VersionedPayload = { ...sourcePayload }
    const [row] = await this.database
      .insert(projectSources)
      .values({
        workspaceId: this.workspaceId,
        projectId,
        kind: sourcePayload.kind,
        sourcePayload: storedPayload,
        sourceFingerprint,
      })
      .returning()
    if (!row) throw new Error('项目来源创建失败')
    return toProjectSource(row)
  }

  async get(projectIdInput: string): Promise<ProjectSourceRecord | null> {
    const projectId = uuidSchema.parse(projectIdInput)
    const [row] = await this.database
      .select()
      .from(projectSources)
      .where(
        and(
          eq(projectSources.workspaceId, this.workspaceId),
          eq(projectSources.projectId, projectId),
        ),
      )
      .limit(1)
    return row ? toProjectSource(row) : null
  }

  private async assertProjectKind(
    projectId: string,
    sourcePayload: ProjectSourcePayload,
  ): Promise<void> {
    const [project] = await this.database
      .select({ kind: projects.workflowKind })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, this.workspaceId),
          eq(projects.id, projectId),
        ),
      )
      .limit(1)
    if (!project) throw new Error(`项目不存在：${projectId}`)
    if (project.kind !== sourcePayload.kind) {
      throw new ProjectSourceKindMismatchError(projectId)
    }
  }
}

function toProjectSource(
  row: typeof projectSources.$inferSelect,
): ProjectSourceRecord {
  const sourcePayload = parseProjectSourcePayload(row.sourcePayload)
  if (row.kind !== sourcePayload.kind) {
    throw new ProjectSourceKindMismatchError(row.projectId)
  }
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    kind: row.kind,
    sourcePayload,
    sourceFingerprint: fingerprintSchema.parse(row.sourceFingerprint),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
