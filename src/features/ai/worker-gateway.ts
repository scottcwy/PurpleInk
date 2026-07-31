import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import type {
  AssistantMessage,
  Context,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import { ManagedAiGateway } from './managed-gateway'
import {
  type WorkerAiRequest,
  type WorkerAiSuccess,
} from './worker-gateway-contract'
import { billingInvocationNo } from '@/features/billing'
import { synthesizeRoutedSpeech } from '@/features/audio'
import {
  createDirectorModelRuntime,
} from '@/features/director/pi-provider'
import { createDirectorModelStream } from '@/features/director/director-gemini-fallback-stream'
import type { DirectorCanvasNodeType } from '@/features/canvas'
import type { PipelineStage } from '@/features/director/types'
import {
  SYSTEM_USER_ID,
  runInAuthContext,
} from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  aiInvocations,
  pipelineRuns,
  taskAttempts,
} from '@/lib/db/schema'

export type WorkerGatewayErrorCode =
  | 'ATTEMPT_NOT_ACTIVE'
  | 'OPERATION_REPLAYED'
  | 'AI_UNAVAILABLE'

export class WorkerGatewayError extends Error {
  override readonly name = 'WorkerGatewayError'

  constructor(readonly code: WorkerGatewayErrorCode) {
    super(code)
  }
}

interface WorkerGatewayDependencies {
  isAttemptActive(
    workspaceId: string,
    attemptId: string,
  ): Promise<boolean>
  hasOperation(workspaceId: string, operationId: string): Promise<boolean>
  generateText(input: Extract<
    WorkerAiRequest,
    { capability: 'text' | 'vision' }
  >): Promise<string>
  synthesizeSpeech(input: Extract<
    WorkerAiRequest,
    { capability: 'tts' }
  >): Promise<{
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav'
    durationMs: number
  }>
}

const DEFAULT_DEPENDENCIES: WorkerGatewayDependencies = {
  isAttemptActive,
  hasOperation,
  generateText: generateWorkerText,
  synthesizeSpeech: synthesizeWorkerSpeech,
}

export async function executeWorkerAiRequest(
  input: WorkerAiRequest,
  dependencies: WorkerGatewayDependencies = DEFAULT_DEPENDENCIES,
): Promise<WorkerAiSuccess> {
  const active = await dependencies.isAttemptActive(
    input.workspaceId,
    input.attemptId,
  )
  if (!active) throw new WorkerGatewayError('ATTEMPT_NOT_ACTIVE')
  if (await dependencies.hasOperation(input.workspaceId, input.operationId)) {
    throw new WorkerGatewayError('OPERATION_REPLAYED')
  }
  return runInAuthContext(
    { workspaceId: input.workspaceId, userId: SYSTEM_USER_ID },
    async () => {
      if (input.capability === 'tts') {
        const speech = await dependencies.synthesizeSpeech(input)
        return {
          ok: true,
          capability: 'tts',
          audioBase64: speech.audioBytes.toString('base64'),
          audioFormat: speech.audioFormat,
          durationMs: speech.durationMs,
        }
      }
      const text = await dependencies.generateText(input)
      return { ok: true, capability: input.capability, text }
    },
  )
}

async function isAttemptActive(
  workspaceId: string,
  attemptId: string,
): Promise<boolean> {
  const database = await getDb()
  const [row] = await database.select({ id: taskAttempts.id })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId),
      ),
    )
    .where(and(
      eq(taskAttempts.workspaceId, workspaceId),
      eq(taskAttempts.id, attemptId),
      eq(taskAttempts.status, 'running'),
      eq(pipelineRuns.status, 'running'),
      isNull(taskAttempts.cancelRequestedAt),
    ))
    .limit(1)
  return Boolean(row)
}

async function hasOperation(
  workspaceId: string,
  operationId: string,
): Promise<boolean> {
  const database = await getDb()
  const [row] = await database.select({ id: aiInvocations.id })
    .from(aiInvocations)
    .where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.operationId, operationId),
    ))
    .limit(1)
  return Boolean(row)
}

async function generateWorkerText(
  input: Extract<WorkerAiRequest, { capability: 'text' | 'vision' }>,
): Promise<string> {
  const route = WORKLOAD_ROUTE[input.workload]
  const runtime = await createDirectorModelRuntime({
    ...route,
    capability: input.capability,
  })
  let observedStatus: number | undefined
  let invocationIndex = input.operationIndex * 2 - 2
  const options: SimpleStreamOptions = {
    maxTokens: Math.min(input.maxOutputTokens, runtime.maxOutputTokens),
    onResponse: (response) => {
      observedStatus = response.status
    },
  }
  const context: Context = {
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    messages: [{
      role: 'user',
      content: input.content,
      timestamp: Date.now(),
    }],
    tools: [],
  }
  const stream = createDirectorModelStream({
    model: runtime.model,
    context,
    options,
    runtime,
    attemptId: input.attemptId,
    nextInvocationIndex: () => ++invocationIndex,
    billingScope: 'worker-text',
    capability: input.capability,
    operationId: input.operationId,
    operation: input.workload,
    source: 'worker',
    gateway: new ManagedAiGateway(),
    getObservedHttpStatus: () => observedStatus,
    onFallbackStarted: () => {
      observedStatus = undefined
    },
    onPreflightFailure: () => undefined,
    onProviderFailure: () => undefined,
    streamSimple: (model, nextContext, nextOptions) =>
      runtime.models.streamSimple(model, nextContext, nextOptions),
  })
  let output = ''
  let failed = false
  for await (const event of stream) {
    if (event.type === 'done') output = assistantText(event.message)
    if (event.type === 'error') failed = true
  }
  if (failed || output.length === 0) {
    throw new WorkerGatewayError('AI_UNAVAILABLE')
  }
  return output
}

async function synthesizeWorkerSpeech(
  input: Extract<WorkerAiRequest, { capability: 'tts' }>,
) {
  return synthesizeRoutedSpeech({
    text: input.text,
    voiceId: input.voiceId,
    billingContext: {
      attemptId: input.attemptId,
      invocationNo: billingInvocationNo('worker-tts', input.operationIndex),
      operationId: input.operationId,
      operation: input.workload,
      source: 'worker',
    },
  })
}

const WORKLOAD_ROUTE: Record<
  Exclude<WorkerAiRequest['workload'], 'website-tts'>,
  { nodeType: DirectorCanvasNodeType; stage: PipelineStage }
> = {
  'website-capture': { nodeType: 'shot-qa', stage: 'FINALIZE' },
  'website-asset-description': { nodeType: 'shot-qa', stage: 'FINALIZE' },
  'website-narration-script': { nodeType: 'shot-script', stage: 'SHOT_SPEC' },
  'website-compose': { nodeType: 'shot-codegen', stage: 'FABRICATE' },
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('')
    .trim()
}

export type { WorkerGatewayDependencies }
