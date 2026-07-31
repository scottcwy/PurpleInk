import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isManagedProvider } from '@/features/ai'
import {
  assertBillingAvailable,
  billingInvocationNo,
} from '@/features/billing'
import {
  captureNodeInputFingerprint,
  transitionNodeStatus,
} from '@/features/canvas'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { taskAttempts } from '@/lib/db/schema'
import {
  assertEnqueueRetryBudget,
  queue as defaultQueue,
  type QueueAdapter,
  type QueueEnqueueReceipt,
  type QueueJob,
} from '@/lib/queue'
import { queueFingerprint } from '@/lib/queue/attempt-checkpoint'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import {
  runAudioTranscriptionJob,
  type AudioTranscriptionExecution,
  type AudioTranscriptionJobInput,
} from './audio-transcription-job'
import { describeMediaProvider } from './media-provider'

const AUDIO_TRANSCRIPTION_KIND = 'audio-transcription'
const AUDIO_WORKFLOW_VERSION = activeWorkflowVersionFor('audio')
const audioTranscriptionPayloadSchema = z
  .object({
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    workflowVersion: z.literal(AUDIO_WORKFLOW_VERSION),
  })
  .strict()

export type AudioTranscriptionQueueInput = z.infer<
  typeof audioTranscriptionPayloadSchema
>

export interface AudioTranscriptionEnqueueDependencies {
  enqueueOnce(
    payload: AudioTranscriptionQueueInput,
    enqueue: () => Promise<string>,
  ): Promise<QueueEnqueueReceipt>
  preflight(): Promise<void>
  captureFingerprint(nodeId: string): Promise<unknown>
  assertRetryBudget(
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void>
  transition(nodeId: string, status: 'pending' | 'running' | 'failed'): Promise<void>
  queue: QueueAdapter
}

type AudioTranscriptionRunner = (
  input: AudioTranscriptionJobInput,
  execution: AudioTranscriptionExecution,
) => Promise<void>

const runAudioTranscription: AudioTranscriptionRunner = (input, execution) =>
  runAudioTranscriptionJob(input, undefined, execution)

export async function runAudioTranscriptionQueueJob(
  job: QueueJob,
  run: AudioTranscriptionRunner = runAudioTranscription,
): Promise<void> {
  const payload = audioTranscriptionPayloadSchema.parse(job.payload)
  const { workflowVersion: _workflowVersion, ...input } = payload
  job.signal?.throwIfAborted()
  await run(
    {
      ...input,
      billingContext: {
        attemptId: z.string().uuid().parse(job.id),
        invocationNo: billingInvocationNo('source-asr', 1),
      },
    },
    {
      attemptId: job.id,
      ...(job.signal ? { signal: job.signal } : {}),
    },
  )
  job.signal?.throwIfAborted()
}

export function registerAudioTranscriptionHandler(
  targetQueue: QueueAdapter = defaultQueue,
  run: AudioTranscriptionRunner = runAudioTranscription,
): void {
  targetQueue.register(AUDIO_TRANSCRIPTION_KIND, (job) =>
    runAudioTranscriptionQueueJob(job, run),
  )
}

export async function enqueueAudioTranscription(
  input: AudioTranscriptionQueueInput,
  dependencies?: AudioTranscriptionEnqueueDependencies,
): Promise<QueueEnqueueReceipt> {
  const payload = audioTranscriptionPayloadSchema.parse(input)
  const resolved = dependencies ?? defaultEnqueueDependencies()
  return resolved.enqueueOnce(payload, async () => {
    await resolved.preflight()
    await resolved.captureFingerprint(payload.nodeId)
    await resolved.assertRetryBudget(AUDIO_TRANSCRIPTION_KIND, payload)
    await resolved.transition(payload.nodeId, 'pending')
    try {
      return await resolved.queue.enqueue(AUDIO_TRANSCRIPTION_KIND, payload, {
        projectId: payload.projectId,
        nodeId: payload.nodeId,
        workflowVersion: payload.workflowVersion,
      })
    } catch (error) {
      await compensateEnqueueFailure(payload.nodeId, resolved, error)
      throw error
    }
  })
}

function defaultEnqueueDependencies(): AudioTranscriptionEnqueueDependencies {
  return {
    enqueueOnce: enqueueAudioOnce,
    preflight: assertAudioTranscriptionBillingAvailable,
    captureFingerprint: captureNodeInputFingerprint,
    assertRetryBudget: assertEnqueueRetryBudget,
    transition: transitionNodeStatus,
    queue: defaultQueue,
  }
}

async function assertAudioTranscriptionBillingAvailable(): Promise<void> {
  const target = await describeMediaProvider('asr')
  if (isManagedProvider(target.provider)) await assertBillingAvailable()
}

async function enqueueAudioOnce(
  payload: AudioTranscriptionQueueInput,
  enqueue: () => Promise<string>,
): Promise<QueueEnqueueReceipt> {
  const database = await getDb()
  const fingerprint = queueFingerprint(AUDIO_TRANSCRIPTION_KIND, payload)
  return database.transaction(async (transaction) => {
    const lockKey = `${AUDIO_TRANSCRIPTION_KIND}:${payload.projectId}:${payload.nodeId}`
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    )
    const [attempt] = await transaction
      .select({ id: taskAttempts.id, status: taskAttempts.status })
      .from(taskAttempts)
      .where(
        and(
          eq(taskAttempts.workspaceId, currentWorkspaceId()),
          eq(taskAttempts.entityType, 'node'),
          eq(taskAttempts.entityId, payload.nodeId),
          eq(taskAttempts.fingerprint, fingerprint),
          inArray(taskAttempts.status, ['queued', 'running', 'succeeded']),
        ),
      )
      .limit(1)
    if (attempt) {
      return {
        attemptId: attempt.id,
        status: z.enum(['queued', 'running', 'succeeded']).parse(attempt.status),
        reused: true,
      }
    }
    return {
      attemptId: await enqueue(),
      status: 'queued',
      reused: false,
    }
  })
}

async function compensateEnqueueFailure(
  nodeId: string,
  dependencies: AudioTranscriptionEnqueueDependencies,
  originalError: unknown,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  for (const status of ['running', 'failed'] as const) {
    try {
      await dependencies.transition(nodeId, status)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...cleanupErrors],
      '录音转写入队失败且节点补偿未完整落地',
    )
  }
}
