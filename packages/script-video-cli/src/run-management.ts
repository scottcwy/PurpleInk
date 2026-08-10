import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import type { CliArgs } from './args'
import type { CliConfig } from './config'
import { SafeCliError } from './safe-error'
import { cancelQueuedJob } from './queue/service'
import { FileStateStore } from './state/file-store'
import { artifactIndexSchema, type RunRecord } from './state/store'
import { executeVideoWorkflow } from './workflow/run-video'
import { findRunInput, type WorkflowRuntime } from './workflow/run-support'

export async function statusCommand(
  args: CliArgs,
  config: CliConfig,
  output?: { writeLine(line: string): void },
): Promise<Record<string, unknown>> {
  const runDir = await resolveRunDir(args.resumeDir, config.stateDir)
  if (args.watch) await watchEvents(runDir, output)
  const store = new FileStateStore(config.stateDir)
  const run = await store.readRun(runDir)
  return { command: 'status', run, stages: await readStages(runDir) }
}

export async function inspectCommand(args: CliArgs, config: CliConfig): Promise<Record<string, unknown>> {
  const runDir = await resolveRunDir(args.resumeDir, config.stateDir)
  const store = new FileStateStore(config.stateDir)
  const run = await store.readRun(runDir)
  const artifacts = await readArtifacts(runDir)
  const selected = args.shotId
    ? artifacts.filter((artifact) => artifact.id.toLowerCase().includes(args.shotId!.toLowerCase()))
    : artifacts
  return {
    command: 'inspect',
    runId: run.runId,
    runDir,
    run,
    stages: await readStages(runDir),
    artifacts: selected,
    logs: await listFiles(join(runDir, 'logs')),
    finalVideoPath: artifacts.find((artifact) => artifact.id === 'video')?.absolutePath ?? null,
  }
}

export async function retryCommand(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
): Promise<Record<string, unknown>> {
  const runDir = await resolveRunDir(args.resumeDir, config.stateDir)
  const inputPath = await findRunInput(runDir)
  return executeVideoWorkflow({ ...args, command: 'run', inputPath, resumeDir: runDir }, config, runtime)
}

export async function cancelCommand(args: CliArgs, config: CliConfig): Promise<Record<string, unknown>> {
  const runDir = await resolveRunDir(args.resumeDir, config.stateDir)
  const store = new FileStateStore(config.stateDir)
  const run = await store.readRun(runDir)
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(join(runDir, 'state', 'cancel.request'), `${new Date().toISOString()}\n`, 'utf8')
  await store.updateRun(runDir, { status: 'cancelled' })
  const queueCancelled = await cancelQueuedJob(runDir, config.stateDir)
  await store.appendEvent(runDir, { type: 'run.cancelled', data: { requested: true } })
  return { command: 'cancel', runId: run.runId, runDir, status: 'cancelled', queueCancelled }
}

export async function resolveRunDir(value: string | undefined, stateDir: string): Promise<string> {
  if (!value) {
    const latest = await findLatestRun(stateDir)
    if (!latest) throw new SafeCliError('RUN_NOT_FOUND', '没有找到本地 run。', false, 404)
    return latest
  }
  const direct = resolve(process.env.INIT_CWD?.trim() || process.cwd(), value)
  if (await exists(join(direct, 'state', 'run.json'))) return direct
  const byId = resolve(stateDir, value)
  if (await exists(join(byId, 'state', 'run.json'))) return byId
  throw new SafeCliError('RUN_NOT_FOUND', '没有找到本地 run。', false, 404)
}

export async function listRuns(stateDir: string): Promise<RunRecord[]> {
  if (!(await exists(stateDir))) return []
  const values = await Promise.all(
    (await readdir(stateDir)).map(async (name) => {
      try {
        return await new FileStateStore(stateDir).readRun(join(stateDir, name))
      } catch {
        return null
      }
    }),
  )
  return values
    .filter((value): value is RunRecord => value !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function watchEvents(runDir: string, output?: { writeLine(line: string): void }): Promise<void> {
  const eventsPath = join(runDir, 'state', 'events.jsonl')
  let delivered = 0
  while (true) {
    if (await exists(eventsPath)) {
      const lines = (await readFile(eventsPath, 'utf8')).split(/\r?\n/u).filter(Boolean)
      for (const line of lines.slice(delivered)) output?.writeLine(line)
      delivered = lines.length
    }
    const run = await new FileStateStore(resolve(runDir, '..')).readRun(runDir)
    if (isTerminalRunStatus(run.status)) return
    await new Promise<void>((done) => setTimeout(done, 500))
  }
}

async function readStages(runDir: string): Promise<unknown[]> {
  const directory = join(runDir, 'state', 'stages')
  if (!(await exists(directory))) return []
  const stages: unknown[] = []
  for (const name of (await readdir(directory)).filter((value) => extname(value) === '.json')) {
    try {
      stages.push(JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown)
    } catch {
      continue
    }
  }
  return stages.sort((a, b) => stageKey(a).localeCompare(stageKey(b)))
}

async function readArtifacts(runDir: string) {
  const path = join(runDir, 'artifacts', 'index.json')
  if (!(await exists(path))) return []
  return artifactIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown).artifacts
}

async function listFiles(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return []
  const result: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    if ((await stat(path)).isFile()) result.push(path)
  }
  return result.sort()
}

async function findLatestRun(stateDir: string): Promise<string | null> {
  return (await listRuns(stateDir))[0]?.runDir ?? null
}

export function isTerminalRunStatus(status: RunRecord['status']): boolean {
  return ['awaiting_agent_review', 'succeeded', 'failed', 'cancelled', 'degraded', 'needs_attention'].includes(status)
}

function stageKey(value: unknown): string {
  return typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string' ? value.key : ''
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
