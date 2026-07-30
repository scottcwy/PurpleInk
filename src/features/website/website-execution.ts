import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commitArtifactRecords } from '@/features/artifacts'
import {
  resolvePersistedExportSettings,
} from '@/features/canvas/export-settings'
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
  soundEffects: ReturnType<typeof resolvePersistedExportSettings>['soundEffects']
}

export interface RunWebsiteVideoInput {
  workspaceId: string
  projectId: string
  attemptId: string
  invocationNo: number
  signal?: AbortSignal
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
    const output = await runBilledWebsiteProject(
      parsed,
      project,
      resolved,
      cursor,
    )
    if (output.verification.outcome === 'degraded') {
      await resolved.stages.block(parsed.projectId, output)
      cursor.terminalProjected = true
      throw new WebsiteExecutionError('WEBSITE_VERIFICATION_FAILED')
    }
    await resolved.stages.complete(parsed.projectId, output)
    cursor.terminalProjected = true
    return output
  } catch (error) {
    if (failureStages && !cursor.terminalProjected) {
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
  try {
    return await dependencies.bill({
      workspaceId: input.workspaceId,
      attemptId: input.attemptId,
      invocationNo: input.invocationNo,
      requestIdentity: websiteRequestIdentity(project),
      maximumDurationSeconds: project.source.durationSec,
      invoke: () => produceWebsiteOutput(input, project, dependencies, cursor),
      completion: (result) => ({
        durationSec: result.durationSec,
        durationSource: result.durationSource,
        outputHash: result.contentHash,
      }),
    })
  } catch (error) {
    if (!cursor.persistedOutput) throw error
    console.error('[website-billing]', JSON.stringify({
      code: 'WEBSITE_BILLING_SETTLEMENT_DEFERRED',
      projectId: input.projectId,
      attemptId: input.attemptId,
    }))
    return cursor.persistedOutput
  }
}

function websiteRequestIdentity(project: WebsiteProjectExecutionInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      sourceFingerprint: project.sourceFingerprint,
      soundEffects: project.soundEffects,
    }))
    .digest('hex')
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
    soundEffects: project.soundEffects,
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
    signal: input.signal,
  })
  input.signal?.throwIfAborted()
  cursor.activePhase = 'export'
  const output = await dependencies.persistOutput({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    attemptId: input.attemptId,
    job: execution.job,
    videoBytes: execution.videoBytes,
  })
  input.signal?.throwIfAborted()
  cursor.persistedOutput = output
  return output
}

interface WebsiteExecutionCursor {
  activePhase: WebsiteWorkflowPhase
  persistedOutput?: PersistedWebsiteOutput
  terminalProjected?: boolean
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
        soundEffects: project.soundEffects,
      }
    },
    engine: new WebsiteEngineClient(),
    stages,
    bill: runManagedWebsiteBilling,
    persistOutput: (output) => persistWebsiteVideoOutput(output, {
      storage,
      commitArtifacts: (artifacts) => commitArtifactRecords(database, artifacts),
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
): Promise<{
  title: string
  soundEffects: ReturnType<typeof resolvePersistedExportSettings>['soundEffects']
}> {
  const [project] = await database
    .select({
      title: projects.title,
      kind: projects.workflowKind,
      exportSettings: projects.exportSettings,
    })
    .from(projects)
    .where(and(
      eq(projects.workspaceId, workspaceId),
      eq(projects.id, projectId),
    ))
    .limit(1)
  if (!project || project.kind !== 'website') {
    throw new WebsiteExecutionError('WEBSITE_PROJECT_INVALID')
  }
  return {
    title: project.title,
    soundEffects:
      resolvePersistedExportSettings(project.exportSettings).soundEffects,
  }
}

function parseRunInput(input: RunWebsiteVideoInput): RunWebsiteVideoInput {
  return {
    workspaceId: uuidSchema.parse(input.workspaceId),
    projectId: uuidSchema.parse(input.projectId),
    attemptId: uuidSchema.parse(input.attemptId),
    invocationNo: z.number().int().positive().parse(input.invocationNo),
    ...(input.signal ? { signal: input.signal } : {}),
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
