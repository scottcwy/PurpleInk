import 'server-only'
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  projectSources,
  taskAttempts,
} from '@/lib/db/schema/index'
import {
  PROJECT_WORKFLOW_KINDS,
  activeWorkflowVersionFor,
  type ProjectWorkflowKind,
} from '@/lib/workflow/project-workflow-registry'

/** 列表页允许的单页上限；API 层同样按此钳位。 */
export const PROJECT_CARD_PAGE_LIMIT = 50
/** 首屏每板块投影条数。 */
export const PROJECT_CARD_FIRST_PAGE_SIZE = 12

export type ProjectCardStatus =
  | 'pending'
  | 'generating'
  | 'recovering'
  | 'rendered'
  | 'failed'

export interface ProjectCardItem {
  id: string
  kind: ProjectWorkflowKind
  title: string
  status: ProjectCardStatus
  shotCount: number
  /** website=规范化 URL；audio=录音文件名；script=文稿前 80 字。缺失时为 null。 */
  sourceSummary: string | null
  updatedAtIso: string
  /** 服务端统一格式化，客户端不再做本地时区格式化，避免水合漂移。 */
  updatedLabel: string
}

export type ProjectKindCounts = Record<ProjectWorkflowKind, number>

export interface ProjectCardPage {
  items: ProjectCardItem[]
  /** 当前 kind + q 过滤下的总数，供分页判断是否还有更多。 */
  total: number
  /** 同一 q 过滤下三类各自总数（无 q 时即全量计数）。 */
  kindCounts: ProjectKindCounts
}

export interface ProjectCardQuery {
  kind?: ProjectWorkflowKind
  q?: string
  offset: number
  limit: number
}

export interface InitialProjectCards {
  pages: Record<ProjectWorkflowKind, ProjectCardItem[]>
  kindCounts: ProjectKindCounts
}

type ProjectCardDatabase = Pick<Db, 'select'>

/**
 * 项目卡片分页投影（server-only）。
 *
 * 性能合同：单页固定 3 条小 SQL（页行 + 节点状态聚合 + 分类计数），
 * 成本只随 limit 增长，不随项目总量增长；完整文稿绝不下发。
 */
export async function loadProjectCardPage(
  database: ProjectCardDatabase,
  workspaceId: string,
  query: ProjectCardQuery,
): Promise<ProjectCardPage> {
  const [items, kindCounts] = await Promise.all([
    loadCardItems(database, workspaceId, query),
    countProjectsByKind(database, workspaceId, query.q),
  ])
  const total = query.kind
    ? kindCounts[query.kind]
    : PROJECT_WORKFLOW_KINDS.reduce((sum, kind) => sum + kindCounts[kind], 0)
  return { items, total, kindCounts }
}

async function loadCardItems(
  database: ProjectCardDatabase,
  workspaceId: string,
  query: ProjectCardQuery,
): Promise<ProjectCardItem[]> {
  const limit = Math.min(Math.max(Math.trunc(query.limit), 1), PROJECT_CARD_PAGE_LIMIT)
  const offset = Math.max(Math.trunc(query.offset), 0)
  const rows = await database
    .select({
      id: projects.id,
      kind: projects.workflowKind,
      title: projects.title,
      updatedAt: projects.updatedAt,
      scriptExcerpt: sql<string>`left(${projects.script}, 80)`,
      sourcePayload: projectSources.sourcePayload,
    })
    .from(projects)
    .leftJoin(
      projectSources,
      and(
        eq(projectSources.workspaceId, projects.workspaceId),
        eq(projectSources.projectId, projects.id),
      ),
    )
    .where(cardFilters(workspaceId, query))
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(limit)
    .offset(offset)
  const stats = await loadNodeStats(
    database,
    workspaceId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toCardItem(row, stats.get(row.id)))
}

/** 会话上下文包装：页面与 API 入口统一从这里读。 */
export async function listProjectCardPage(
  query: ProjectCardQuery,
): Promise<ProjectCardPage> {
  const database = await getDb()
  return loadProjectCardPage(database, currentWorkspaceId(), query)
}

/** 首屏投影：三板块各取首页，分类计数只查一次。 */
export async function listInitialProjectCards(
  perKindLimit = PROJECT_CARD_FIRST_PAGE_SIZE,
): Promise<InitialProjectCards> {
  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const pageOf = (kind: ProjectWorkflowKind) =>
    loadCardItems(database, workspaceId, { kind, offset: 0, limit: perKindLimit })
  const [kindCounts, script, audio, website] = await Promise.all([
    countProjectsByKind(database, workspaceId, undefined),
    pageOf('script'),
    pageOf('audio'),
    pageOf('website'),
  ])
  return {
    pages: { script, audio, website },
    kindCounts,
  }
}

function cardFilters(workspaceId: string, query: Pick<ProjectCardQuery, 'kind' | 'q'>): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    eq(projects.workspaceId, workspaceId),
    activeWorkflowFilter(),
  ]
  if (query.kind) conditions.push(eq(projects.workflowKind, query.kind))
  const q = query.q?.trim()
  if (q) conditions.push(ilike(projects.title, `%${escapeLikePattern(q)}%`))
  return and(...conditions)
}

/** 与 listProjects 相同的活跃版本口径：legacy 项目不进入普通列表。 */
function activeWorkflowFilter(): SQL | undefined {
  return or(
    ...PROJECT_WORKFLOW_KINDS.map((kind) =>
      and(
        eq(projects.workflowKind, kind),
        eq(projects.workflowVersion, activeWorkflowVersionFor(kind)),
      ),
    ),
  )
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (char) => `\\${char}`)
}

interface NodeStatRow {
  projectId: string
  nodeCount: number
  shotCount: number
  failedCount: number
  activeNodeCount: number
  hasCurrentAttempt: boolean
  succeededCount: number
}

async function loadNodeStats(
  database: ProjectCardDatabase,
  workspaceId: string,
  projectIds: string[],
): Promise<Map<string, NodeStatRow>> {
  if (projectIds.length === 0) return new Map()
  const rows = await database
    .select({
      projectId: canvasNodes.projectId,
      nodeCount: sql<number>`count(*)::int`,
      shotCount: sql<number>`count(*) filter (where ${canvasNodes.type} = 'shot-codegen')::int`,
      failedCount: sql<number>`count(*) filter (where ${canvasNodes.status} = 'failed')::int`,
      activeNodeCount: sql<number>`count(*) filter (where ${canvasNodes.status} in ('queued', 'running'))::int`,
      hasCurrentAttempt: sql<boolean>`exists (
        select 1
        from ${taskAttempts}
        inner join ${pipelineRuns}
          on ${pipelineRuns.workspaceId} = ${taskAttempts.workspaceId}
          and ${pipelineRuns.id} = ${taskAttempts.runId}
        where ${taskAttempts.workspaceId} = ${workspaceId}
          and ${pipelineRuns.projectId} = ${canvasNodes.projectId}
          and ${pipelineRuns.executionEpoch} = ${projects.executionEpoch}
          and ${taskAttempts.status} in ('queued', 'running')
      )`,
      succeededCount: sql<number>`count(*) filter (where ${canvasNodes.status} = 'succeeded')::int`,
    })
    .from(canvasNodes)
    .innerJoin(projects, and(
      eq(projects.workspaceId, canvasNodes.workspaceId),
      eq(projects.id, canvasNodes.projectId),
    ))
    .where(
      and(
        eq(canvasNodes.workspaceId, workspaceId),
        inArray(canvasNodes.projectId, projectIds),
      ),
    )
    .groupBy(canvasNodes.projectId, projects.executionEpoch)
  return new Map(rows.map((row) => [row.projectId, row]))
}

async function countProjectsByKind(
  database: ProjectCardDatabase,
  workspaceId: string,
  q: string | undefined,
): Promise<ProjectKindCounts> {
  const rows = await database
    .select({ kind: projects.workflowKind, value: count() })
    .from(projects)
    .where(cardFilters(workspaceId, { q }))
    .groupBy(projects.workflowKind)
  const counts: ProjectKindCounts = { script: 0, audio: 0, website: 0 }
  for (const row of rows) counts[row.kind] = Number(row.value)
  return counts
}

interface CardRow {
  id: string
  kind: ProjectWorkflowKind
  title: string
  updatedAt: Date
  scriptExcerpt: string
  sourcePayload: unknown
}

function toCardItem(row: CardRow, stat: NodeStatRow | undefined): ProjectCardItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: deriveStatus(stat),
    shotCount: stat?.shotCount ?? 0,
    sourceSummary: summarizeSource(row.kind, row.sourcePayload, row.scriptExcerpt),
    updatedAtIso: row.updatedAt.toISOString(),
    updatedLabel: row.updatedAt.toLocaleString('zh-CN'),
  }
}

/** 与旧页面逐图推导一致：失败 > 执行中 > 全部成功 > 待生成。 */
function deriveStatus(stat: NodeStatRow | undefined): ProjectCardStatus {
  if (!stat || stat.nodeCount === 0) return 'pending'
  if (stat.hasCurrentAttempt) return 'generating'
  if (stat.failedCount > 0) return 'failed'
  if (stat.activeNodeCount > 0) return 'recovering'
  if (stat.succeededCount === stat.nodeCount) return 'rendered'
  return 'pending'
}

function summarizeSource(
  kind: ProjectWorkflowKind,
  payload: unknown,
  scriptExcerpt: string,
): string | null {
  if (kind === 'script') {
    const excerpt = scriptExcerpt.replace(/\s+/gu, ' ').trim()
    return excerpt || null
  }
  if (payload === null || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const field = kind === 'website' ? record.url : record.fileName
  return typeof field === 'string' && field.length > 0 ? field : null
}
