import { copyFile, readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { chromium } from 'playwright'

import { createConfiguredAiClient, getConfigSummary, type CliConfig } from './config'
import type { CliArgs } from './args'
import { readScriptFile } from './input'
import { FileStateStore } from './state/file-store'
import { createPlan } from './workflow/plan'
import { generateShots, type CodegenResult } from './workflow/codegen'
import { assembleProject, type AssemblyResult } from './workflow/assemble'
import { runChromiumGate } from './workflow/gates'
import { renderHyperframesProject, type HyperframesRenderResult } from './render/hyperframes'
import { inspectVideoArtifact, type MediaQaResult } from './qa/media'
import { WORKFLOW_VERSION } from './config'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

export interface CommandIo {
  writeLine(line: string): void
}

export class CliCommandError extends Error {
  constructor(
    readonly code: 'INPUT_REQUIRED' | 'RUN_NOT_FOUND' | 'MEDIA_QA_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'CliCommandError'
  }
}

export async function executeCliCommand(args: CliArgs, config: CliConfig): Promise<unknown> {
  const effectiveConfig = args.provider ? { ...config, provider: args.provider } : config
  if (args.command === 'help') return { command: 'help', usage: helpText() }
  if (args.command === 'doctor') return runDoctor(effectiveConfig)
  if (args.command === 'status') return runStatus(args, effectiveConfig)
  if (args.command === 'plan') return runPlan(args, effectiveConfig)
  if (args.command === 'run') return runVideo(args, effectiveConfig)
  throw new Error('config 命令必须由 CLI 配置边界处理')
}

async function runPlan(args: CliArgs, config: CliConfig): Promise<unknown> {
  const source = await requireInput(args)
  const store = new FileStateStore(resolveOutputDir(args, config))
  const run = await prepareRun(store, source, args.resumeDir)
  try {
    await store.updateRun(run.runDir, { status: 'running' })
    const plan = await createPlan(source.input, createConfiguredAiClient(config), { store, runDir: run.runDir })
    await store.updateRun(run.runDir, { status: 'degraded' })
    await store.appendEvent(run.runDir, { type: 'plan.succeeded', data: { shotCount: plan.shots.length } })
    return {
      command: 'plan',
      runId: run.runId,
      runDir: run.runDir,
      fingerprint: plan.fingerprint,
      director: plan.director,
      shots: plan.shots,
    }
  } catch (error) {
    await markRunFailed(store, run.runDir, error)
    throw error
  }
}

async function runVideo(args: CliArgs, config: CliConfig): Promise<unknown> {
  const source = await requireInput(args)
  const store = new FileStateStore(resolveOutputDir(args, config))
  const run = await prepareRun(store, source, args.resumeDir)
  try {
    await store.updateRun(run.runDir, { status: 'running' })
    await store.appendEvent(run.runDir, { type: 'run.started', data: { workflowVersion: WORKFLOW_VERSION } })
    const ai = createConfiguredAiClient(config)
    const plan = await createPlan(source.input, ai, { store, runDir: run.runDir })
    const codegen = await generateShots(source.input, plan.shots, {
      ai,
      outputDir: run.runDir,
      concurrency: args.concurrency ?? config.concurrency,
      runtimeGate: args.skipBrowserGate ? undefined : (path) => runChromiumGate(path),
      store,
      runDir: run.runDir,
    })
    const assembly = await assembleProject(source.input, plan.shots, codegen, {
      outputDir: run.runDir,
      narration: { mode: args.narration ?? source.input.narration },
    })
    const rendered = await renderHyperframesProject(assembly.projectDir)
    const media = await inspectVideoArtifact(rendered.videoPath, { expectedDurationSec: assembly.durationSec })
    if (!media.passed) throw new CliCommandError('MEDIA_QA_FAILED', '视频媒体 QA 未通过')
    await recordVideoArtifact(store, run.runDir, rendered, media)
    const degraded = args.skipBrowserGate || assembly.narration.status === 'degraded'
    await store.updateRun(run.runDir, { status: degraded ? 'degraded' : 'succeeded' })
    await store.appendEvent(run.runDir, { type: 'run.succeeded', data: { degraded, video: 'video' } })
    return createRunSummary(run.runId, run.runDir, plan.shots.length, codegen, assembly, rendered, media, degraded)
  } catch (error) {
    await markRunFailed(store, run.runDir, error)
    throw error
  }
}

async function prepareRun(
  store: FileStateStore,
  source: Awaited<ReturnType<typeof readScriptFile>>,
  resumeDir: string | undefined,
) {
  if (resumeDir) {
    const runDir = resolveUserPath(resumeDir)
    await store.assertResumeCompatible(runDir, { inputHash: source.inputHash, workflowVersion: WORKFLOW_VERSION })
    return store.readRun(runDir)
  }
  const run = await store.createRun({
    inputHash: source.inputHash,
    title: source.input.title,
    workflowVersion: WORKFLOW_VERSION,
  })
  await copyFile(source.sourcePath, join(run.runDir, 'input', basename(source.sourcePath)))
  return run
}

async function requireInput(args: CliArgs) {
  if (!args.inputPath) throw new CliCommandError('INPUT_REQUIRED', 'run/plan 需要输入脚本文件')
  return readScriptFile(resolveUserPath(args.inputPath))
}

async function runStatus(args: CliArgs, config: CliConfig): Promise<unknown> {
  const runDir = args.resumeDir ? resolveUserPath(args.resumeDir) : await findLatestRun(resolveOutputDir(args, config))
  if (!runDir) throw new CliCommandError('RUN_NOT_FOUND', '没有找到本地 run')
  const store = new FileStateStore(resolveOutputDir(args, config))
  const run = await store.readRun(runDir)
  const stages = await readStageSummaries(join(runDir, 'state', 'stages'))
  return { command: 'status', run, stages }
}

async function runDoctor(config: CliConfig): Promise<unknown> {
  const [ffprobe, hyperframes] = await Promise.all([checkCommand('ffprobe', ['-version']), checkHyperframes()])
  const chromiumPath = chromium.executablePath()
  let chromiumAvailable = false
  try {
    await stat(chromiumPath)
    chromiumAvailable = true
  } catch {
    chromiumAvailable = false
  }
  return {
    command: 'doctor',
    config: getConfigSummary(config),
    checks: {
      node: { ok: Number(process.versions.node.split('.')[0]) >= 22, version: process.versions.node },
      ffprobe: ffprobe.ok,
      hyperframes: hyperframes.ok,
      chromium: { ok: chromiumAvailable, executableConfigured: chromiumPath.length > 0 },
    },
  }
}

async function recordVideoArtifact(
  store: FileStateStore,
  runDir: string,
  rendered: HyperframesRenderResult,
  media: MediaQaResult,
): Promise<void> {
  await store.writeArtifact(runDir, {
    id: 'video',
    kind: 'video/mp4',
    relativePath: toPortableRelative(runDir, rendered.videoPath),
    sizeBytes: media.sizeBytes,
    contentHash: media.contentHash,
  })
}

function createRunSummary(
  runId: string,
  runDir: string,
  shotCount: number,
  codegen: CodegenResult,
  assembly: AssemblyResult,
  rendered: HyperframesRenderResult,
  media: MediaQaResult,
  degraded: boolean,
): Record<string, unknown> {
  return {
    command: 'run',
    runId,
    runDir,
    shotCount,
    shots: {
      succeeded: codegen.succeeded.length,
      failed: codegen.failed.map((shot) => ({ id: shot.id, errorCode: shot.errorCode })),
    },
    projectDir: assembly.projectDir,
    videoPath: rendered.videoPath,
    durationSec: media.metadata?.durationSec ?? assembly.durationSec,
    media: { sizeBytes: media.sizeBytes, contentHash: media.contentHash, metadata: media.metadata },
    narration: assembly.narration,
    status: degraded ? 'degraded' : 'succeeded',
  }
}

async function markRunFailed(store: FileStateStore, runDir: string, error: unknown): Promise<void> {
  try {
    await store.updateRun(runDir, { status: 'failed' })
    await store.appendEvent(runDir, { type: 'run.failed', data: { code: errorCode(error) } })
  } catch {
    /* preserve the original workflow failure */
  }
}

async function findLatestRun(root: string): Promise<string | null> {
  try {
    await stat(root)
  } catch {
    return null
  }
  const names = await readdir(root)
  const candidates = await Promise.all(
    names.map(async (name) => {
      const path = join(root, name)
      try {
        return { path, modified: (await stat(join(path, 'state', 'run.json'))).mtimeMs }
      } catch {
        return null
      }
    }),
  )
  return (
    candidates
      .filter((value): value is { path: string; modified: number } => value !== null)
      .sort((a, b) => b.modified - a.modified)[0]?.path ?? null
  )
}

async function readStageSummaries(directory: string): Promise<Array<{ key: string; status: string; attempt: number }>> {
  try {
    await stat(directory)
  } catch {
    return []
  }
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json'))
  const summaries: Array<{ key: string; status: string; attempt: number }> = []
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown
      if (
        isRecord(value) &&
        typeof value.key === 'string' &&
        typeof value.status === 'string' &&
        typeof value.attempt === 'number'
      ) {
        summaries.push({ key: value.key, status: value.status, attempt: value.attempt })
      }
    } catch {
      /* ignore malformed diagnostics; run.json remains authoritative */
    }
  }
  return summaries.sort((a, b) => a.key.localeCompare(b.key))
}

async function checkCommand(command: string, args: string[]): Promise<{ ok: boolean }> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 5_000 })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

async function checkHyperframes(): Promise<{ ok: boolean }> {
  try {
    const packageJson = require.resolve('hyperframes/package.json')
    await execFileAsync(process.execPath, [join(dirname(packageJson), 'bin', 'hyperframes.mjs'), '--version'], {
      windowsHide: true,
      timeout: 5_000,
    })
    return { ok: true }
  } catch {
    return checkCommand(hyperframesCommand(), ['--version'])
  }
}

function resolveOutputDir(args: CliArgs, config: CliConfig): string {
  return args.outputDir ? resolveUserPath(args.outputDir) : config.stateDir
}
function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD?.trim() || process.cwd(), path)
}
function toPortableRelative(root: string, path: string): string {
  return relative(root, path)
    .split(/[\\/]+/u)
    .join('/')
}
function hyperframesCommand(): string {
  return process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes'
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'CLI_FAILED'
}
function helpText(): string {
  return [
    'purpleink-video config set text --url <url> --model <id> --key-stdin',
    'purpleink-video config show --json',
    'purpleink-video config verify text --json',
    'purpleink-video run <script.json|script.md> [--concurrency N] [--narration off|auto|required]',
    'purpleink-video plan <script.json|script.md> [--provider fixture|openai-compatible]',
    'purpleink-video status [--run <run-directory>]',
    'purpleink-video doctor',
    '通用参数：--json、--output <state-root>、--resume <run-directory>、--no-browser-gate。',
  ].join('\n')
}
