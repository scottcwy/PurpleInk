import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { canvasNodes, projects } from '@/lib/db/schema'
import type { QueueEnqueueReceipt } from '@/lib/queue'
import {
  isActiveProjectWorkflow,
  type ProjectWorkflowKind,
} from '@/lib/workflow/project-workflow-registry'
import {
  PostgresProjectSourceRepository,
  ProjectSourceKindMismatchError,
} from './project-source-repository'
import type { ProjectSourceRecord } from './project-source'
import {
  buildProjectTopology,
  projectWorkflowEntryLogicalKey,
} from './project-topology'

const uuidSchema = z.string().uuid()

export interface ProjectWorkflowStartDescriptor {
  kind: ProjectWorkflowKind
  workflowVersion: string
  entryNodeId: string
}

interface ScriptStartResult {
  autopilot: true
  status: 'started' | 'blocked' | 'complete'
  enqueuedNodeIds: string[]
  repairRootNodeIds: string[]
  failedNodeIds: string[]
  blockedNodes: Array<{ nodeId: string; code: string; message: string }>
}

export type ProjectWorkflowStartResult =
  | ({ kind: 'script'; entryNodeId: string } & ScriptStartResult)
  | {
      kind: 'audio'
      entryNodeId: string
      jobId: string
      attemptStatus: QueueEnqueueReceipt['status']
      reused: boolean
      status: ScriptStartResult['status']
      enqueuedNodeIds: string[]
      repairRootNodeIds: string[]
      failedNodeIds: string[]
      blockedNodes: ScriptStartResult['blockedNodes']
    }
  | {
      kind: 'website'
      entryNodeId: string
      jobId: string
      attemptStatus: QueueEnqueueReceipt['status']
      reused: boolean
      status: 'started' | 'complete'
      enqueuedNodeIds: string[]
    }

export interface ProjectWorkflowStartDependencies {
  loadDescriptor(projectId: string): Promise<ProjectWorkflowStartDescriptor>
  startScript(projectId: string): Promise<ScriptStartResult>
  enqueueAudio(input: {
    projectId: string
    nodeId: string
    workflowVersion: string
  }): Promise<QueueEnqueueReceipt>
  enqueueWebsite(input: {
    projectId: string
    workflowVersion: string
  }): Promise<QueueEnqueueReceipt>
}

export class ProjectWorkflowStartError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_WORKFLOW_NOT_FOUND'
      | 'PROJECT_WORKFLOW_ENTRY_MISSING'
      | 'PROJECT_WORKFLOW_KIND_MISMATCH'
      | 'PROJECT_WORKFLOW_VERSION_UNSUPPORTED',
    message: string,
    readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'ProjectWorkflowStartError'
  }
}

/** 按已持久化来源分派，客户端不能通过请求体选择或改写工作流类型。 */
export async function startProjectWorkflow(
  projectIdInput: string,
  dependencies?: ProjectWorkflowStartDependencies,
): Promise<ProjectWorkflowStartResult> {
  const projectId = uuidSchema.parse(projectIdInput)
  const resolved = dependencies ?? defaultDependencies()
  const descriptor = await resolved.loadDescriptor(projectId)

  if (descriptor.kind === 'script') {
    return {
      kind: 'script',
      entryNodeId: descriptor.entryNodeId,
      ...(await resolved.startScript(projectId)),
    }
  }
  if (descriptor.kind === 'audio') {
    const receipt = await resolved.enqueueAudio({
      projectId,
      nodeId: descriptor.entryNodeId,
      workflowVersion: descriptor.workflowVersion,
    })
    if (receipt.status === 'succeeded') {
      return {
        kind: 'audio',
        entryNodeId: descriptor.entryNodeId,
        jobId: receipt.attemptId,
        attemptStatus: receipt.status,
        reused: receipt.reused,
        ...(await resolved.startScript(projectId)),
      }
    }
    return {
      kind: 'audio',
      entryNodeId: descriptor.entryNodeId,
      status: 'started',
      jobId: receipt.attemptId,
      attemptStatus: receipt.status,
      reused: receipt.reused,
      enqueuedNodeIds:
        receipt.status === 'queued' ? [descriptor.entryNodeId] : [],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    }
  }
  const receipt = await resolved.enqueueWebsite({
    projectId,
    workflowVersion: descriptor.workflowVersion,
  })
  return {
    kind: 'website',
    entryNodeId: descriptor.entryNodeId,
    status: receipt.status === 'succeeded' ? 'complete' : 'started',
    jobId: receipt.attemptId,
    attemptStatus: receipt.status,
    reused: receipt.reused,
    enqueuedNodeIds:
      receipt.status === 'queued' ? [descriptor.entryNodeId] : [],
  }
}

function defaultDependencies(): ProjectWorkflowStartDependencies {
  return {
    loadDescriptor: loadProjectWorkflowStartDescriptor,
    startScript: async (projectId) => {
      const { startProjectPipeline } = await import('@/features/director/advance')
      return startProjectPipeline(projectId)
    },
    enqueueAudio: async (input) => {
      const { enqueueAudioTranscription } = await import('@/features/audio')
      return enqueueAudioTranscription(input)
    },
    enqueueWebsite: async (input) => {
      const { enqueueWebsiteVideo } = await import('@/features/website')
      return enqueueWebsiteVideo(input)
    },
  }
}

export async function loadProjectWorkflowStartDescriptor(
  projectId: string,
): Promise<ProjectWorkflowStartDescriptor> {
  const workspaceId = currentWorkspaceId()
  const database = await getDb()
  const [project] = await database
    .select({
      kind: projects.workflowKind,
      workflowVersion: projects.workflowVersion,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ),
    )
    .limit(1)
  if (!project) {
    throw new ProjectWorkflowStartError(
      'PROJECT_WORKFLOW_NOT_FOUND',
      '项目不存在',
      404,
    )
  }
  if (!isActiveProjectWorkflow(project.kind, project.workflowVersion)) {
    throw new ProjectWorkflowStartError(
      'PROJECT_WORKFLOW_VERSION_UNSUPPORTED',
      '旧版项目暂不可执行，数据已保留',
      409,
    )
  }
  let record: ProjectSourceRecord | null
  try {
    record = await new PostgresProjectSourceRepository(
      database,
      workspaceId,
    ).get(projectId)
  } catch (error) {
    if (error instanceof ProjectSourceKindMismatchError) {
      throw workflowKindMismatch()
    }
    throw error
  }
  if (!record && project.kind !== 'script') {
    throw new ProjectWorkflowStartError(
      'PROJECT_WORKFLOW_NOT_FOUND',
      '项目来源不存在',
      404,
    )
  }
  if (record && record.kind !== project.kind) throw workflowKindMismatch()
  const entryLogicalKey = record
    ? buildProjectTopology(record.sourcePayload).entryLogicalKey
    : projectWorkflowEntryLogicalKey('script')
  const [entry] = await database
    .select({ id: canvasNodes.id })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, workspaceId),
        eq(canvasNodes.projectId, projectId),
        eq(canvasNodes.logicalKey, entryLogicalKey),
      ),
    )
    .limit(1)
  if (!entry) {
    throw new ProjectWorkflowStartError(
      'PROJECT_WORKFLOW_ENTRY_MISSING',
      '项目工作流入口不存在',
      409,
    )
  }
  return {
    kind: project.kind,
    workflowVersion: project.workflowVersion,
    entryNodeId: entry.id,
  }
}

function workflowKindMismatch(): ProjectWorkflowStartError {
  return new ProjectWorkflowStartError(
    'PROJECT_WORKFLOW_KIND_MISMATCH',
    '项目来源类型与工作流不一致',
    409,
  )
}
