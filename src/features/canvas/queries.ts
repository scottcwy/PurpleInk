import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  artifacts,
  canvasEdges,
  canvasNodes,
  projects,
} from '@/lib/db/schema/index'
import type { NodePosition } from './layout'
import { canvasNodeTypeSchema } from './schemas'
import { resolveExportSettings, type ExportSettings } from './export-settings'
import type { CanvasNodeType, NodeStatus, Project } from './types'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import {
  parseDirectorError,
  parseExecutionNotice,
  parseRenderError,
  type DirectorNodeError,
  type RenderNodeError,
} from './node-error-projection'
import type { WorkflowExecutionNotice } from './workflow-fault'
export type { DirectorNodeError, RenderNodeError } from './node-error-projection'

export interface CanvasNodeArtifact {
  id: string
  kind: string
  filename: string
}

export interface CanvasGraphNode {
  id: string
  type: CanvasNodeType
  status: NodeStatus
  stage: string | null
  contentHash: string | null
  data: Record<string, unknown>
  laneKey: string | null
  laneRole: string | null
  artifacts: CanvasNodeArtifact[]
  directorError?: DirectorNodeError
  renderError?: RenderNodeError
  executionNotice?: WorkflowExecutionNotice
}

/** 挂了渲染坐标的画布节点；坐标只来自 `computeLayout`，不是持久化字段。 */
export type PositionedCanvasNode = CanvasGraphNode & { position: NodePosition }

export interface CanvasGraphEdge {
  id: string
  source: string
  target: string
}

export interface CanvasGraph {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
}
/** 只列出当前横屏 workflow 项目（按更新时间倒序）。 */
export async function listProjects(): Promise<Project[]> {
  const database = await getDb()
  return database
    .select({
      id: projects.id,
      title: projects.title,
      script: projects.script,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(
          projects.workflowVersion,
          serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)
        )
      )
    )
    .orderBy(desc(projects.updatedAt))
}
/** 读取项目导出设置；null/缺省时回退 DEFAULT_EXPORT_SETTINGS。项目不存在抛错。 */
export async function getExportSettings(projectId: string): Promise<ExportSettings> {
  const database = await getDb()
  const [row] = await database
    .select({ exportSettings: projects.exportSettings })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId)
      )
    )
  if (!row) throw new Error(`项目不存在：${projectId}`)
  return resolveExportSettings(readObject(row.exportSettings).settings)
}
/** 读取项目级自动推进真实状态；项目不存在时抛错。 */
export async function getProjectAutopilot(projectId: string): Promise<boolean> {
  const database = await getDb()
  const [row] = await database
    .select({ autopilot: projects.autopilot })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId)
      )
    )
  if (!row) throw new Error(`项目不存在：${projectId}`)
  return row.autopilot
}
/** 读取单个项目的画布投影；不会跨项目返回节点或边。 */
export async function getCanvasGraph(projectId: string): Promise<CanvasGraph> {
  const database = await getDb()
  const nodeRows = await database
    .select({
      id: canvasNodes.id,
      type: canvasNodes.type,
      status: canvasNodes.status,
      stage: canvasNodes.stage,
      data: canvasNodes.data,
    })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        eq(canvasNodes.projectId, projectId)
      )
    )
  const nodes = await Promise.all(
    nodeRows.map(async (node): Promise<CanvasGraphNode> => {
      const data = readNodePayload(node.data)
      return {
        id: node.id,
        type: canvasNodeTypeSchema.parse(node.type),
        status: fromPersistedStatus(node.status),
        stage: node.stage,
        contentHash:
          typeof data.outputContentHash === 'string'
            ? data.outputContentHash
            : typeof data.contentHash === 'string'
              ? data.contentHash
              : null,
        data,
        laneKey: typeof data.laneKey === 'string' ? data.laneKey : null,
        laneRole: typeof data.laneRole === 'string' ? data.laneRole : null,
        artifacts: await getNodeArtifacts(projectId, node.id),
        directorError: parseDirectorError(data),
        renderError: parseRenderError(data),
        executionNotice: parseExecutionNotice(data.executionNotice),
      }
    })
  )
  const edges = await database
    .select({
      id: canvasEdges.id,
      source: canvasEdges.source,
      target: canvasEdges.target,
    })
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.workspaceId, currentWorkspaceId()),
        eq(canvasEdges.projectId, projectId)
      )
    )
  return { nodes, edges }
}
/** 某节点当前真实存在的产物列表（按最新优先），排除内部会话指针。 */
export async function getNodeArtifacts(
  projectId: string,
  nodeId: string
): Promise<CanvasNodeArtifact[]> {
  const database = await getDb()
  const rows = await database
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      storageKey: artifacts.storageKey,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, currentWorkspaceId()),
        eq(artifacts.projectId, projectId),
        eq(artifacts.aggregateType, 'node'),
        eq(artifacts.aggregateId, nodeId)
      )
    )
    .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
  return rows
    .filter(
      (row) => row.kind !== 'pi-session' && row.kind !== 'director-stream-log'
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      filename: basenameOf(row.storageKey),
    }))
}

export interface NodeStreamContext {
  status: CanvasGraphNode['status']
  directorError?: DirectorNodeError
}

/** 单节点流式上下文（含项目归属校验）：不存在或不属于该项目返回 null。 */
export async function getNodeStreamContext(
  projectId: string,
  nodeId: string
): Promise<NodeStreamContext | null> {
  const database = await getDb()
  const [row] = await database
    .select({ status: canvasNodes.status, data: canvasNodes.data })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        eq(canvasNodes.id, nodeId),
        eq(canvasNodes.projectId, projectId)
      )
    )
  if (!row) return null
  return {
    status: fromPersistedStatus(row.status),
    directorError: parseDirectorError(readNodePayload(row.data)),
  }
}

function basenameOf(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readNodePayload(value: unknown): Record<string, unknown> {
  return readObject(readObject(value).payload)
}

function fromPersistedStatus(status: string): NodeStatus {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'success'
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'stale' ||
    status === 'skipped'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}
