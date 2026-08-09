import { PgBoss, type Job } from 'pg-boss'

import { parseCliArgs, type CliArgs } from '../args'
import type { CliConfig } from '../config'
import { SafeCliError } from '../safe-error'
import { FileStateStore } from '../state/file-store'
import { executeVideoWorkflow } from '../workflow/run-video'
import { findRunInput, prepareRun, type WorkflowRuntime } from '../workflow/run-support'

export const RUN_QUEUE = 'purpleink-script-video-run'
export const DEFAULT_QUEUE_DATABASE_URL = 'postgres://purpleink:purpleink@127.0.0.1:54329/purpleink'

interface RunJobPayload {
  runId: string
  runDir: string
}

export function queueDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PURPLEINK_QUEUE_DATABASE_URL?.trim() || DEFAULT_QUEUE_DATABASE_URL
}

export async function createQueueBoss(env: NodeJS.ProcessEnv = process.env): Promise<PgBoss> {
  const boss = new PgBoss(queueDatabaseUrl(env))
  boss.on('error', () => undefined)
  await boss.start()
  await boss.createQueue(RUN_QUEUE, {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    retryDelayMax: 60,
    expireInSeconds: 3_600,
    heartbeatSeconds: 30,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    notify: true,
  })
  return boss
}

export async function submitCommand(
  args: CliArgs,
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const inputs = args.inputPaths ?? []
  if (inputs.length === 0) throw new SafeCliError('INPUT_REQUIRED', 'submit 至少需要一个输入文件。', false, 400)
  const boss = await connectSafely(env)
  const receipts: Array<{ runId: string; runDir: string; jobId: string }> = []
  try {
    for (const input of inputs) {
      const runArgv = ['run', input, '--output', config.stateDir]
      if (args.globalPromptPath) runArgv.push('--global-prompt-file', args.globalPromptPath)
      const runArgs = parseCliArgs(runArgv)
      const prepared = await prepareRun(runArgs, config)
      const jobId = await boss.send(
        RUN_QUEUE,
        { runId: prepared.run.runId, runDir: prepared.run.runDir },
        { singletonKey: prepared.run.runId },
      )
      if (!jobId) throw new SafeCliError('QUEUE_SUBMIT_FAILED', '任务未能写入持久队列。', true, 503)
      await new FileStateStore(config.stateDir).updateRun(prepared.run.runDir, { status: 'queued', queueJobId: jobId })
      receipts.push({ runId: prepared.run.runId, runDir: prepared.run.runDir, jobId })
    }
  } finally {
    await boss.stop({ graceful: true })
  }
  return { command: 'submit', receipts }
}

export async function startRunWorker(boss: PgBoss, config: CliConfig, runtime: WorkflowRuntime): Promise<string> {
  return boss.work<RunJobPayload>(
    RUN_QUEUE,
    {
      localConcurrency: config.channels.run,
      batchSize: 1,
      pollingIntervalSeconds: 1,
      heartbeatRefreshSeconds: 10,
    },
    async (jobs) => {
      for (const job of jobs) await processRunJob(job, config, runtime)
      return { processed: jobs.length }
    },
  )
}

export async function cancelQueuedJob(
  runDir: string,
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const run = await new FileStateStore(stateDir).readRun(runDir)
  if (!run.queueJobId) return false
  let boss: PgBoss | undefined
  try {
    boss = await createQueueBoss(env)
    await boss.cancel(RUN_QUEUE, run.queueJobId)
    return true
  } catch {
    return false
  } finally {
    await boss?.stop({ graceful: true }).catch(() => undefined)
  }
}

export async function queueSnapshot(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const boss = await connectSafely(env)
  try {
    const [queue] = await boss.getQueueStats(RUN_QUEUE, { force: true, limit: 1 })
    return queue
      ? {
          queued: queue.queuedCount,
          ready: queue.readyCount,
          active: queue.activeCount,
          failed: queue.failedCount,
          total: queue.totalCount,
        }
      : { queued: 0, ready: 0, active: 0, failed: 0, total: 0 }
  } finally {
    await boss.stop({ graceful: true })
  }
}

async function processRunJob(job: Job<RunJobPayload>, config: CliConfig, runtime: WorkflowRuntime): Promise<void> {
  const payload = validatePayload(job.data)
  const store = new FileStateStore(config.stateDir)
  const run = await store.readRun(payload.runDir)
  if (run.runId !== payload.runId)
    throw new SafeCliError('QUEUE_PAYLOAD_INVALID', '队列任务与 run 不匹配。', false, 422)
  if (run.status === 'cancelled') return
  const inputPath = await findRunInput(payload.runDir)
  const args = parseCliArgs(['run', inputPath, '--resume', payload.runDir, '--json'])
  const result = await executeVideoWorkflow(args, config, { ...runtime, signal: job.signal })
  if (result.status === 'needs_attention') return
}

function validatePayload(value: unknown): RunJobPayload {
  if (!isRecord(value) || typeof value.runId !== 'string' || typeof value.runDir !== 'string') {
    throw new SafeCliError('QUEUE_PAYLOAD_INVALID', '队列任务内容无效。', false, 422)
  }
  return { runId: value.runId, runDir: value.runDir }
}

async function connectSafely(env: NodeJS.ProcessEnv): Promise<PgBoss> {
  try {
    return await createQueueBoss(env)
  } catch {
    throw new SafeCliError('QUEUE_DATABASE_UNAVAILABLE', 'PostgreSQL 持久队列不可用。', true, 503)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
