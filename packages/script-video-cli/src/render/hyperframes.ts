import { access, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runLoggedProcess } from '../media/ffmpeg'

const require = createRequire(import.meta.url)

export interface CommandOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
  logPath?: string
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandResult>

export interface HyperframesRenderOptions {
  cliPath?: string
  quality?: 'draft' | 'standard' | 'high'
  fps?: number
  timeoutMs?: number
  signal?: AbortSignal
  runner?: CommandRunner
  logPath?: string
}

export interface HyperframesRenderResult {
  checkPassed: boolean
  videoPath: string
  durationSec?: number
}

export class HyperframesError extends Error {
  constructor(
    readonly code: 'HYPERFRAMES_CHECK_FAILED' | 'HYPERFRAMES_RENDER_FAILED' | 'VIDEO_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'HyperframesError'
  }
}

export async function renderHyperframesProject(
  projectDir: string,
  options: HyperframesRenderOptions = {},
): Promise<HyperframesRenderResult> {
  const runner = options.runner ?? runCommand
  const invocation = options.cliPath ? { command: options.cliPath, prefix: [] as string[] } : defaultCliInvocation()
  const commandOptions = {
    cwd: projectDir,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 20 * 60 * 1000,
    logPath: options.logPath,
  }
  options.signal?.throwIfAborted()
  const check = await runner(invocation.command, [...invocation.prefix, 'check'], commandOptions)
  const renderArgs = ['render', '--quality', options.quality ?? 'standard']
  if (options.fps !== undefined) renderArgs.push('--fps', String(options.fps))
  const render = await runner(invocation.command, [...invocation.prefix, ...renderArgs], commandOptions)
  if (render.code !== 0) throw new HyperframesError('HYPERFRAMES_RENDER_FAILED', 'HyperFrames render failed')
  const videoPath = await findLatestVideo(join(projectDir, 'renders'))
  if (!videoPath) throw new HyperframesError('VIDEO_NOT_FOUND', 'HyperFrames 没有产生 MP4 产物')
  return { checkPassed: check.code === 0, videoPath }
}

async function findLatestVideo(rendersDir: string): Promise<string | null> {
  try {
    await access(rendersDir)
  } catch {
    return null
  }
  const candidates = (await readdir(rendersDir))
    .filter((name) => name.toLowerCase().endsWith('.mp4'))
    .map((name) => join(rendersDir, name))
  const files = await Promise.all(candidates.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs })))
  return files.sort((a, b) => b.modified - a.modified)[0]?.path ?? null
}

function defaultCliInvocation(): { command: string; prefix: string[] } {
  try {
    const packageJson = require.resolve('hyperframes/package.json')
    return { command: process.execPath, prefix: [join(dirname(packageJson), 'bin', 'hyperframes.mjs')] }
  } catch {
    return { command: 'hyperframes', prefix: [] }
  }
}

const runCommand: CommandRunner = (command, args, options) => runLoggedProcess(command, args, options)
