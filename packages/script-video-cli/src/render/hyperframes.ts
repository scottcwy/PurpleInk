import { spawn } from 'node:child_process'
import { access, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface CommandOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>

export interface HyperframesRenderOptions {
  cliPath?: string
  quality?: 'draft' | 'standard' | 'high'
  fps?: number
  timeoutMs?: number
  signal?: AbortSignal
  runner?: CommandRunner
}

export interface HyperframesRenderResult {
  checkPassed: true
  videoPath: string
  durationSec?: number
}

export class HyperframesError extends Error {
  constructor(readonly code: 'HYPERFRAMES_CHECK_FAILED' | 'HYPERFRAMES_RENDER_FAILED' | 'VIDEO_NOT_FOUND', message: string) {
    super(message)
    this.name = 'HyperframesError'
  }
}

export async function renderHyperframesProject(
  projectDir: string,
  options: HyperframesRenderOptions = {},
): Promise<HyperframesRenderResult> {
  const runner = options.runner ?? runCommand
  const cliPath = options.cliPath ?? defaultCliPath()
  const commandOptions = { cwd: projectDir, signal: options.signal, timeoutMs: options.timeoutMs ?? 20 * 60 * 1000 }
  options.signal?.throwIfAborted()
  const check = await runner(cliPath, ['check'], commandOptions)
  if (check.code !== 0) throw new HyperframesError('HYPERFRAMES_CHECK_FAILED', 'HyperFrames composition check failed')
  const renderArgs = ['render', '--quality', options.quality ?? 'standard']
  if (options.fps !== undefined) renderArgs.push('--fps', String(options.fps))
  const render = await runner(cliPath, renderArgs, commandOptions)
  if (render.code !== 0) throw new HyperframesError('HYPERFRAMES_RENDER_FAILED', 'HyperFrames render failed')
  const videoPath = await findLatestVideo(join(projectDir, 'renders'))
  if (!videoPath) throw new HyperframesError('VIDEO_NOT_FOUND', 'HyperFrames 没有产生 MP4 产物')
  return { checkPassed: true, videoPath }
}

async function findLatestVideo(rendersDir: string): Promise<string | null> {
  try { await access(rendersDir) } catch { return null }
  const candidates = (await readdir(rendersDir))
    .filter((name) => name.toLowerCase().endsWith('.mp4'))
    .map((name) => join(rendersDir, name))
  const files = await Promise.all(candidates.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs })))
  return files.sort((a, b) => b.modified - a.modified)[0]?.path ?? null
}

function defaultCliPath(): string {
  return process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes'
}

const runCommand: CommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), options.timeoutMs)
  const abort = () => child.kill()
  options.signal?.addEventListener('abort', abort, { once: true })
  child.on('error', reject)
  child.on('close', (code) => {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    resolve({ code: code ?? 1, stdout, stderr })
  })
})
