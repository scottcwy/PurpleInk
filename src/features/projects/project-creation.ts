import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { canvasEdges, canvasNodes, projects } from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
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
}

export interface ProjectCreationDependencies {
  database?: Db
  workspaceId?: string
  createId?: () => string
}

export interface CreatedProject {
  project: Project
  entryNodeId: string
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

  return withTransaction(database, async (transaction) => {
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
    const entryNode = nodeRows[0]
    if (!entryNode) throw new Error('项目工作流没有入口节点')
    await transaction.insert(canvasNodes).values(nodeRows)

    const nodeIds = new Map(
      nodeRows.map((node) => [node.logicalKey, node.id] as const),
    )
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
    return { project, entryNodeId: entryNode.id }
  })
}

function requiredNodeId(nodes: ReadonlyMap<string, string>, logicalKey: string): string {
  const id = nodes.get(logicalKey)
  if (!id) throw new Error(`项目拓扑引用了不存在的节点：${logicalKey}`)
  return id
}
