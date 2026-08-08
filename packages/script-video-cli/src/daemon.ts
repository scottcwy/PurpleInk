import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CliArgs } from './args'
import type { CliConfig } from './config'
import { runLoggedProcess } from './media/ffmpeg'
import { startObserver, type ObserverHandle } from './observer'
import { createQueueBoss, queueSnapshot, startRunWorker } from './queue/service'
import { SafeCliError } from './safe-error'
import type { WorkflowRuntime } from './workflow/run-support'

interface DaemonState {
  schemaVersion: 1
  running: boolean
  pid: number
  startedAt: string
  heartbeatAt: string
  observerUrl?: string
  stoppedAt?: string
}

interface DaemonPaths {
  rootDir: string
  statePath: string
  stopRequestPath: string
  logPath: string
}

export async function daemonCommand(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  if (args.daemonAction === 'start') return startDaemon(args, env)
  if (args.daemonAction === 'status') return daemonStatus(env)
  if (args.daemonAction === 'stop') return stopDaemon(env)
  if (args.daemonAction === 'worker') return runDaemonWorker(args, config, runtime, env)
  throw new SafeCliError('DAEMON_ACTION_INVALID', 'daemon 命令无效。', false, 400)
}

async function startDaemon(args: CliArgs, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const paths = daemonPaths(env)
  const current = await readState(paths)
  if (current?.running && heartbeatFresh(current)) {
    return { command: 'daemon.start', alreadyRunning: true, ...publicState(current) }
  }
  await mkdir(paths.rootDir, { recursive: true })
  await rm(paths.stopRequestPath, { force: true })
  await startPostgres(paths.logPath)
  const child = spawn(process.execPath, daemonChildArgs(args.serveWithDaemon === true), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.env.INIT_CWD?.trim() || process.cwd(),
    env,
  })
  child.unref()
  const state = await waitForRunningState(paths, child.pid)
  return { command: 'daemon.start', alreadyRunning: false, ...publicState(state) }
}

async function daemonStatus(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const state = await readState(daemonPaths(env))
  const running = Boolean(state?.running && heartbeatFresh(state))
  const queue = running ? await queueSnapshot(env).catch(() => ({ unavailable: true })) : null
  return { command: 'daemon.status', running, ...(state ? publicState(state) : {}), queue }
}

async function stopDaemon(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const paths = daemonPaths(env)
  const state = await readState(paths)
  if (!state?.running || !heartbeatFresh(state)) return { command: 'daemon.stop', stopped: true, wasRunning: false }
  await writeFile(paths.stopRequestPath, `${new Date().toISOString()}\n`, 'utf8')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const next = await readState(paths)
    if (!next?.running) return { command: 'daemon.stop', stopped: true, wasRunning: true }
    await delay(500)
  }
  throw new SafeCliError('DAEMON_STOP_TIMEOUT', 'daemon 未能在超时前停止。', true, 504)
}

async function runDaemonWorker(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const paths = daemonPaths(env)
  await mkdir(paths.rootDir, { recursive: true })
  const startedAt = new Date().toISOString()
  let observer: ObserverHandle | undefined
  const boss = await createQueueBoss(env)
  if (args.serveWithDaemon) observer = await startObserver({ stateDir: config.stateDir, port: 0 })
  await startRunWorker(boss, config, runtime)
  const heartbeat = async (): Promise<void> => {
    await writeState(paths, {
      schemaVersion: 1,
      running: true,
      pid: process.pid,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      ...(observer ? { observerUrl: observer.url } : {}),
    })
  }
  await heartbeat()
  const timer = setInterval(() => void heartbeat(), 2_000)
  let stop = false
  const requestStop = (): void => {
    stop = true
  }
  process.once('SIGINT', requestStop)
  process.once('SIGTERM', requestStop)
  try {
    while (!stop && !(await exists(paths.stopRequestPath))) await delay(500)
  } finally {
    clearInterval(timer)
    await boss.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined)
    await observer?.close().catch(() => undefined)
    await writeState(paths, {
      schemaVersion: 1,
      running: false,
      pid: process.pid,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    })
    await rm(paths.stopRequestPath, { force: true })
  }
  return { command: 'daemon.worker', stopped: true }
}

function daemonPaths(env: NodeJS.ProcessEnv): DaemonPaths {
  const local = env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
  const rootDir = resolve(local, 'PurpleInk', 'daemon')
  return {
    rootDir,
    statePath: join(rootDir, 'state.json'),
    stopRequestPath: join(rootDir, 'stop.request'),
    logPath: join(rootDir, 'daemon.log'),
  }
}

async function startPostgres(logPath: string): Promise<void> {
  const composePath = resolve(dirname(fileURLToPath(import.meta.url)), '../docker-compose.yml')
  const result = await runLoggedProcess(
    'docker',
    ['compose', '--project-name', 'purpleink-video-cli', '-f', composePath, 'up', '-d', '--wait'],
    { logPath, timeoutMs: 120_000 },
  )
  if (result.code !== 0)
    throw new SafeCliError('DOCKER_POSTGRES_FAILED', '无法启动 PostgreSQL 17 持久队列。', true, 503)
}

function daemonChildArgs(serve: boolean): string[] {
  const currentEntry = process.argv[1]
  if (currentEntry && /purpleink-video\.mjs$/u.test(currentEntry)) {
    return [currentEntry, 'daemon', 'worker', ...(serve ? ['--serve'] : [])]
  }
  const modulePath = fileURLToPath(import.meta.url)
  const extension = extname(modulePath) === '.ts' ? '.ts' : '.js'
  const cliPath = resolve(dirname(modulePath), `../cli${extension}`)
  return [...process.execArgv, cliPath, 'daemon', 'worker', ...(serve ? ['--serve'] : [])]
}

async function waitForRunningState(paths: DaemonPaths, expectedPid: number | undefined): Promise<DaemonState> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const state = await readState(paths)
    if (state?.running && (!expectedPid || state.pid === expectedPid) && heartbeatFresh(state)) return state
    await delay(250)
  }
  throw new SafeCliError('DAEMON_START_TIMEOUT', 'daemon 未能在超时前启动。', true, 504)
}

async function readState(paths: DaemonPaths): Promise<DaemonState | null> {
  try {
    const value = JSON.parse(await readFile(paths.statePath, 'utf8')) as unknown
    return isDaemonState(value) ? value : null
  } catch {
    return null
  }
}

async function writeState(paths: DaemonPaths, state: DaemonState): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true })
  const temporary = `${paths.statePath}.tmp-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, paths.statePath)
}

function heartbeatFresh(state: DaemonState): boolean {
  return Date.now() - new Date(state.heartbeatAt).getTime() < 15_000
}

function publicState(state: DaemonState): Record<string, unknown> {
  return {
    pid: state.pid,
    startedAt: state.startedAt,
    heartbeatAt: state.heartbeatAt,
    observerUrl: state.observerUrl ?? null,
  }
}

function isDaemonState(value: unknown): value is DaemonState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'running' in value &&
    typeof value.running === 'boolean' &&
    'pid' in value &&
    typeof value.pid === 'number' &&
    'startedAt' in value &&
    typeof value.startedAt === 'string' &&
    'heartbeatAt' in value &&
    typeof value.heartbeatAt === 'string'
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds))
}
