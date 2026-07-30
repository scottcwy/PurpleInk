import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commitArtifactRecord } from '@/features/artifacts'
import {
  PostgresProjectSourceRepository,
  type WebsiteProjectSourcePayload,
} from '@/features/projects'
import { getDb } from '@/lib/db/client'
import { projects } from '@/lib/db/schema'
import { storage } from '@/lib/storage'
import { WebsiteEngineClient } from './engine-client'
import {
  executeWebsiteEngine,
  WEBSITE_EXECUTION_TIMEOUT_MS,
  WEBSITE_POLL_INTERVAL_MS,
  WebsiteExecutionError,
  websiteFailureCode,
} from './website-engine-execution'
import {
  runManagedWebsiteBilling,
  type ManagedWebsiteBillingInput,
} from './managed-billing'
import {
  persistWebsiteVideoOutput,
  type PersistedWebsiteOutput,
} from './website-output'
import {
  createWebsiteStageProjector,
} from './website-stage-repository'
import type {
  WebsiteStageProgress,
  WebsiteStageProjector,
  WebsiteWorkflowPhase,
} from './website-stage-contract'

const uuidSchema = z.string().uuid()

export interface WebsiteProjectExecutionInput {
  title: string
  source: WebsiteProjectSourcePayload
  sourceFingerprint: string
}

export interface RunWebsiteVideoInput {
  workspaceId: string
  projectId: string
  attemptId: string
  invocationNo: number
}

export interface WebsiteExecutionDependencies {
  loadProject(projectId: string): Promise<WebsiteProjectExecutionInput>
  engine: Pick<WebsiteEngineClient, 'start' | 'getJob' | 'downloadVideo'>
  stages: WebsiteStageProjector
  bill<T>(input: ManagedWebsiteBillingInput<T>): Promise<T>
  persistOutput(input: {
    workspaceId: string
    projectId: string
    attemptId: string
    job: Awaited<ReturnType<WebsiteEngineClient['getJob']>>
    videoBytes: Buffer
  }): Promise<PersistedWebsiteOutput>
  nowMs(): number
  sleep(milliseconds: number): Promise<void>
  pollIntervalMs: number
  timeoutMs: number
}

export async function runWebsiteVideo(
  input: RunWebsiteVideoInput,
  dependencies?: WebsiteExecutionDependencies,
): Promise<PersistedWebsiteOutput> {
  const parsed = parseRunInput(input)
  const cursor: WebsiteExecutionCursor = {
    activePhase: 'capture',
  }
  let failureStages = dependencies?.stages

  try {
    let resolved = dependencies
    if (!resolved) {
      const stages = await createWebsiteStageProjector()
      failureStages = stages
      resolved = await createDefaultDependencies(parsed.workspaceId, stages)
    }
    const project = await resolved.loadProject(parsed.projectId)
    return await runBilledWebsiteProject(parsed, project, resolved, cursor)
  } catch (error) {
    if (cursor.completedOutput) {
      console.error('[website-billing]', JSON.stringify({
        code: 'WEBSITE_BILLING_SETTLEMENT_DEFERRED',
        projectId: parsed.projectId,
        attemptId: parsed.attemptId,
      }))
      return cursor.completedOutput
    }
    if (failureStages) {
      await projectFailureWithoutMasking(
        failureStages,
        parsed.projectId,
        cursor.activePhase,
        error,
      )
    }
    throw error
  }
}

async function runBilledWebsiteProject(
  input: RunWebsiteVideoInput,
  project: WebsiteProjectExecutionInput,
  dependencies: WebsiteExecutionDependencies,
  cursor: WebsiteExecutionCursor,
): Promise<PersistedWebsiteOutput> {
  return dependencies.bill({
    workspaceId: input.workspaceId,
    attemptId: input.attemptId,
    invocationNo: input.invocationNo,
    requestIdentity: project.sourceFingerprint,
    maximumDurationSeconds: project.source.durationSec,
    invoke: () => produceWebsiteOutput(input, project, dependencies, cursor),
    completion: (result) => ({
      durationSec: result.durationSec,
      durationSource: result.durationSource,
      outputHash: result.contentHash,
    }),
  })
}

async function produceWebsiteOutput(
  input: RunWebsiteVideoInput,
  project: WebsiteProjectExecutionInput,
  dependencies: WebsiteExecutionDependencies,
  cursor: WebsiteExecutionCursor,
): Promise<PersistedWebsiteOutput> {
  const execution = await executeWebsiteEngine({
    projectId: input.projectId,
    attemptId: input.attemptId,
    url: project.source.url,
    name: project.title,
    durationSec: project.source.durationSec,
    quality: project.source.quality,
  }, {
    engine: dependencies.engine,
    onProgress: async (progress: WebsiteStageProgress) => {
      cursor.activePhase = progress.phase
      await dependencies.stages.progress(input.projectId, progress)
    },
    nowMs: dependencies.nowMs,
    sleep: dependencies.sleep,
    pollIntervalMs: dependencies.pollIntervalMs,
    timeoutMs: Math.min(dependencies.timeoutMs, WEBSITE_EXECUTION_TIMEOUT_MS),
  })
  cursor.activePhase = 'export'
  const output = await dependencies.persistOutput({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    attemptId: input.attemptId,
    job: execution.job,
    videoBytes: execution.videoBytes,
  })
  await dependencies.stages.complete(input.projectId, output)
  cursor.completedOutput = output
  return output
}

interface WebsiteExecutionCursor {
  activePhase: WebsiteWorkflowPhase
  completedOutput?: PersistedWebsiteOutput
}

async function createDefaultDependencies(
  workspaceId: string,
  stages: WebsiteStageProjector,
): Promise<WebsiteExecutionDependencies> {
  const database = await getDb()
  const sourceRepository = new PostgresProjectSourceRepository(database, workspaceId)
  return {
    loadProject: async (projectId) => {
      const [project, source] = await Promise.all([
        loadWebsiteProject(database, workspaceId, projectId),
        sourceRepository.get(projectId),
      ])
      if (!source || source.sourcePayload.kind !== 'website') {
        throw new WebsiteExecutionError('WEBSITE_PROJECT_INVALID')
      }
      return {
        title: project.title,
        source: source.sourcePayload,
        sourceFingerprint: source.sourceFingerprint,
      }
    },
    engine: new WebsiteEngineClient(),
    stages,
    bill: runManagedWebsiteBilling,
    persistOutput: (output) => persistWebsiteVideoOutput(output, {
      storage,
      commitArtifact: (artifact) => commitArtifactRecord(database, artifact),
    }),
    nowMs: Date.now,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollIntervalMs: WEBSITE_POLL_INTERVAL_MS,
    timeoutMs: WEBSITE_EXECUTION_TIMEOUT_MS,
  }
}

async function loadWebsiteProject(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  projectId: string,
): Promise<{ title: string }> {
  const [project] = await database
    .select({ title: projects.title, kind: projects.workflowKind })
    .from(projects)
    .where(and(
      eq(projects.workspaceId, workspaceId),
      eq(projects.id, projectId),
    ))
    .limit(1)
  if (!project || project.kind !== 'website') {
    throw new WebsiteExecutionError('WEBSITE_PROJECT_INVALID')
  }
  return { title: project.title }
}

function parseRunInput(input: RunWebsiteVideoInput): RunWebsiteVideoInput {
  return {
    workspaceId: uuidSchema.parse(input.workspaceId),
    projectId: uuidSchema.parse(input.projectId),
    attemptId: uuidSchema.parse(input.attemptId),
    invocationNo: z.number().int().positive().parse(input.invocationNo),
  }
}

async function projectFailureWithoutMasking(
  stages: WebsiteStageProjector,
  projectId: string,
  phase: WebsiteWorkflowPhase,
  originalError: unknown,
): Promise<void> {
  try {
    await stages.fail(projectId, phase, websiteFailureCode(originalError))
  } catch (projectionError) {
    throw new AggregateError(
      [originalError, projectionError],
      '网站视频执行失败且工作流终态投影失败',
    )
  }
}
