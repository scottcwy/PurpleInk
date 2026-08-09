import { stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'

import { chromium } from 'playwright'

import { getConfigSummary, type CliConfig } from './config'
import { createOpenAiCompatibleClient } from './ai/openai-compatible'
import { verifySpeechRoundTrip } from './config-command'
import type { CliArgs } from './args'
import { FileStateStore } from './state/file-store'
import { cancelCommand, inspectCommand, retryCommand, statusCommand } from './run-management'
import { serveCommand } from './observer'
import { daemonCommand } from './daemon'
import { submitCommand } from './queue/service'
import {
  executePlanWorkflow,
  executeTranscribeWorkflow,
  executeVideoWorkflow,
  type WorkflowRuntime,
} from './workflow/run-video'

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

export async function executeCliCommand(args: CliArgs, config: CliConfig, runtime: WorkflowRuntime): Promise<unknown> {
  const effectiveConfig = args.provider ? { ...config, provider: args.provider } : config
  if (args.command === 'help') return { command: 'help', usage: helpText() }
  if (args.command === 'doctor') return runDoctor(args, effectiveConfig, runtime)
  if (args.command === 'status') return statusCommand(args, effectiveConfig, runtime.output)
  if (args.command === 'inspect') return inspectCommand(args, effectiveConfig)
  if (args.command === 'retry') return retryCommand(args, effectiveConfig, runtime)
  if (args.command === 'cancel') return cancelCommand(args, effectiveConfig)
  if (args.command === 'serve') return serveCommand(args, effectiveConfig)
  if (args.command === 'submit') return submitCommand(args, effectiveConfig)
  if (args.command === 'daemon') return daemonCommand(args, effectiveConfig, runtime)
  if (args.command === 'plan') return executePlanWorkflow(args, effectiveConfig, runtime)
  if (args.command === 'transcribe') return executeTranscribeWorkflow(args, effectiveConfig, runtime)
  if (args.command === 'run') return executeVideoWorkflow(args, effectiveConfig, runtime)
  throw new Error('config 命令必须由 CLI 配置边界处理')
}

async function runDoctor(args: CliArgs, config: CliConfig, runtime: WorkflowRuntime): Promise<unknown> {
  const [ffprobe, hyperframes] = await Promise.all([checkCommand('ffprobe', ['-version']), checkHyperframes()])
  const chromiumPath = chromium.executablePath()
  let chromiumAvailable = false
  try {
    await stat(chromiumPath)
    chromiumAvailable = true
  } catch {
    chromiumAvailable = false
  }
  const live = args.live ? await runLiveChecks(runtime) : undefined
  return {
    command: 'doctor',
    config: getConfigSummary(config),
    checks: {
      node: { ok: Number(process.versions.node.split('.')[0]) >= 22, version: process.versions.node },
      ffprobe: ffprobe.ok,
      hyperframes: hyperframes.ok,
      chromium: { ok: chromiumAvailable, executableConfigured: chromiumPath.length > 0 },
    },
    ...(live ? { live } : {}),
  }
}

async function runLiveChecks(runtime: WorkflowRuntime): Promise<Record<string, unknown>> {
  const textStarted = Date.now()
  let text: Record<string, unknown>
  try {
    const config = await runtime.localStore.loadTextProvider()
    const result = await createOpenAiCompatibleClient({ ...config, maxRetries: 0 }).completeJson({
      system: '只返回 JSON。',
      user: '返回 {"ok":true}。',
    })
    text = { ok: isRecord(result) && result.ok === true, latencyMs: Date.now() - textStarted }
  } catch {
    text = { ok: false, latencyMs: Date.now() - textStarted }
  }
  const speechStarted = Date.now()
  let speech: Record<string, unknown>
  try {
    await verifySpeechRoundTrip(await runtime.localStore.loadSpeechProvider())
    speech = { ok: true, tts: true, asr: true, latencyMs: Date.now() - speechStarted }
  } catch {
    speech = { ok: false, tts: false, asr: false, latencyMs: Date.now() - speechStarted }
  }
  return { text, speech }
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

function hyperframesCommand(): string {
  return process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes'
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function helpText(): string {
  return [
    'purpleink-video config set text --url <url> --model <id> --key-stdin',
    'purpleink-video config set speech --url <url> --tts-model <id> --asr-model <id> --key-stdin',
    'purpleink-video config show --json',
    'purpleink-video config verify all --json',
    'purpleink-video voice import <sample.wav|sample.mp3> --name <id>',
    'purpleink-video voice use <id|mimo_default>',
    'purpleink-video voice list --json',
    'purpleink-video run <script.json|script.md> [--global-prompt-file <path>] [--concurrency N] [--narration off|auto|required]',
    'purpleink-video plan <script.json|script.md> [--global-prompt-file <path>] [--provider fixture|openai-compatible]',
    'purpleink-video transcribe <audio.wav|audio.mp3> --json',
    'purpleink-video submit <input...> [--global-prompt-file <path>] --json',
    'purpleink-video daemon start [--serve] | status --json | stop',
    'purpleink-video status [--run <id|path>] [--watch]',
    'purpleink-video inspect --run <id|path> [--shot S001] --json',
    'purpleink-video retry --run <id|path> [--shot S001|--failed]',
    'purpleink-video cancel --run <id|path>',
    'purpleink-video serve [--run <id|path>] [--port 0]',
    'purpleink-video doctor [--live]',
    '通用参数：--json、--output <state-root>、--resume <run-directory>。',
  ].join('\n')
}
