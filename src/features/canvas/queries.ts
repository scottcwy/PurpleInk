import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  artifacts,
  canvasEdges,
  canvasNodes,
  projects,
} from '@/lib/db/schema/index'
import { canvasNodeTypeSchema } from './schemas'
import { resolveExportSettings, type ExportSettings } from './export-settings'
import type { CanvasNodeType, NodeStatus, Project } from './types'

export interface CanvasNodeArtifact {
  id: string
  kind: string
  filename: string
}

/** 可展示的 Director 阶段失败信息（源自 canvas_nodes.data.directorError）。 */
export interface DirectorNodeError {
  stage: string
  message: string
}

export interface CanvasGraphNode {
  id: string
  type: CanvasNodeType
  status: NodeStatus
  stage: string | null
  contentHash: string | null
  data: Record<string, unknown>
  position: { x: number; y: number }
  laneKey: string | null
  laneRole: string | null
  artifacts: CanvasNodeArtifact[]
  directorError?: DirectorNodeError
}

export interface CanvasGraphEdge {
  id: string
  source: string
  target: string
}

export interface CanvasGraph {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
}
/** 列出全部项目（按更新时间倒序）。 */
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
    .where(eq(projects.workspaceId, LOCAL_WORKSPACE_ID))
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
        eq(projects.workspaceId, LOCAL_WORKSPACE_ID),
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
        eq(projects.workspaceId, LOCAL_WORKSPACE_ID),
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
      positionX: canvasNodes.positionX,
      positionY: canvasNodes.positionY,
    })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
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
          typeof data.contentHash === 'string' ? data.contentHash : null,
        data,
        position: { x: node.positionX, y: node.positionY },
        laneKey: typeof data.laneKey === 'string' ? data.laneKey : null,
        laneRole: typeof data.laneRole === 'string' ? data.laneRole : null,
        artifacts: await getNodeArtifacts(projectId, node.id),
        directorError: parseDirectorError(data),
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
        eq(canvasEdges.workspaceId, LOCAL_WORKSPACE_ID),
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
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
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

/** 从节点 data 收窄出可展示的 Director 失败信息（无 / 形状不符时返回 undefined）。 */
export function parseDirectorError(
  data: Record<string, unknown>
): DirectorNodeError | undefined {
  const raw = data.directorError
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.stage !== 'string' || typeof record.message !== 'string') {
    return undefined
  }
  return { stage: record.stage, message: record.message }
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
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
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
    status === 'stale'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}
