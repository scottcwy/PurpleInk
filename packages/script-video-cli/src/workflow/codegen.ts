import { createHash } from 'node:crypto'
import { mkdir, access, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import type { AiClient } from '../ai/openai-compatible'
import { mapWithConcurrency } from '../ai/concurrency'
import type { ScriptVideoInput, ShotPlan } from '../contracts'
import type { StateStore } from '../state/store'
import { runChromiumGate, validateShotHtml, type RuntimeGateResult } from './gates'

export interface CodegenOptions {
  ai: AiClient
  outputDir: string
  concurrency: number
  runtimeGate?: (htmlPath: string) => Promise<RuntimeGateResult>
  store?: StateStore
  runDir?: string
  signal?: AbortSignal
}

export interface CodegenShotResult {
  id: string
  sourceUnitId: string
  status: 'succeeded' | 'failed'
  attempt: number
  relativeHtmlPath?: string
  screenshotHashes?: string[]
  errorCode?: 'SHOT_OUTPUT_INVALID' | 'SHOT_GATE_FAILED' | 'BROWSER_GATE_FAILED' | 'AI_PROVIDER_ERROR'
}

export interface CodegenResult {
  succeeded: CodegenShotResult[]
  failed: CodegenShotResult[]
}

export async function generateShots(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  options: CodegenOptions,
): Promise<CodegenResult> {
  const results = await mapWithConcurrency(
    plans,
    options.concurrency,
    async (shot) => generateOneShot(input, shot, options),
    { signal: options.signal },
  )
  return {
    succeeded: results.filter((result) => result.status === 'succeeded'),
    failed: results.filter((result) => result.status === 'failed'),
  }
}

async function generateOneShot(
  input: ScriptVideoInput,
  shot: ShotPlan,
  options: CodegenOptions,
): Promise<CodegenShotResult> {
  const fingerprint = createHash('sha256').update(JSON.stringify({ input, shot }), 'utf8').digest('hex')
  const key = `FABRICATE:${shot.id}`
  const previous = options.store && options.runDir ? await options.store.readStage(options.runDir, key) : null
  const previousResult = previous?.status === 'succeeded' ? parseStoredResult(previous.payload) : null
  if (previous && previous.fingerprint === fingerprint && previousResult?.status === 'succeeded') {
    const storedPath = resolve(options.outputDir, previousResult.relativeHtmlPath ?? '')
    if (previousResult.relativeHtmlPath && (await exists(storedPath))) return previousResult
  }

  const attempt = (previous?.attempt ?? 0) + 1
  await writeStage(options, key, 'running', attempt, fingerprint, {})
  try {
    const unit = input.units.find((candidate) => candidate.id === shot.sourceUnitId)
    if (!unit) throw new CodegenFailure('SHOT_OUTPUT_INVALID')
    const raw = await options.ai.completeText({
      system: '你是 FABRICATE 镜头代码生成器。只返回完整 HTML，不要 Markdown 围栏，不得联网，不得写入 credential。',
      user: [
        `目标镜头：${shot.id}`,
        '不得新增来源文稿之外的事实；不得使用外部 URL、远程字体、图片或脚本。',
        `来源单元：${JSON.stringify(unit)}`,
        `镜头合同：${JSON.stringify(shot)}`,
        'HTML 必须包含 data-pi-seed、window.__PURPLEINK_RENDER__、ready:true、durationSec 和可调用的 seek(progress)。',
      ].join('\n'),
      signal: options.signal,
    })
    const html = normalizeHtml(raw)
    const staticGate = validateShotHtml(html)
    if (!staticGate.passed) throw new CodegenFailure('SHOT_GATE_FAILED')
    const shotDir = join(options.outputDir, 'shots', shot.id, `attempt-${String(attempt).padStart(3, '0')}`)
    await mkdir(shotDir, { recursive: true })
    const htmlPath = join(shotDir, 'source.html')
    await writeFile(htmlPath, `${html}\n`, 'utf8')
    const runtime = options.runtimeGate ? await options.runtimeGate(htmlPath) : await runChromiumGate(htmlPath)
    if (!runtime.passed) {
      throw new CodegenFailure(runtime.errors[0] === 'BROWSER_GATE_FAILED' ? 'BROWSER_GATE_FAILED' : 'SHOT_GATE_FAILED')
    }
    const result: CodegenShotResult = {
      id: shot.id,
      sourceUnitId: shot.sourceUnitId,
      status: 'succeeded',
      attempt,
      relativeHtmlPath: relative(options.outputDir, htmlPath),
      screenshotHashes: runtime.screenshotHashes,
    }
    await writeStage(options, key, 'succeeded', attempt, fingerprint, result)
    return result
  } catch (error) {
    const errorCode = error instanceof CodegenFailure ? error.code : 'AI_PROVIDER_ERROR'
    const result: CodegenShotResult = {
      id: shot.id,
      sourceUnitId: shot.sourceUnitId,
      status: 'failed',
      attempt,
      errorCode,
    }
    await writeStage(options, key, 'failed', attempt, fingerprint, { errorCode })
    return result
  }
}

class CodegenFailure extends Error {
  constructor(readonly code: NonNullable<CodegenShotResult['errorCode']>) {
    super(code)
    this.name = 'CodegenFailure'
  }
}

function normalizeHtml(raw: string): string {
  const fenced = raw.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/iu)
  const html = (fenced?.[1] ?? raw).trim()
  if (!/<html[\s>]/iu.test(html)) throw new CodegenFailure('SHOT_OUTPUT_INVALID')
  return html
}

function parseStoredResult(value: unknown): CodegenShotResult | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sourceUnitId !== 'string') return null
  if (value.status !== 'succeeded' || typeof value.attempt !== 'number' || typeof value.relativeHtmlPath !== 'string')
    return null
  return {
    id: value.id,
    sourceUnitId: value.sourceUnitId,
    status: 'succeeded',
    attempt: value.attempt,
    relativeHtmlPath: value.relativeHtmlPath,
    screenshotHashes: Array.isArray(value.screenshotHashes)
      ? value.screenshotHashes.filter((hash): hash is string => typeof hash === 'string')
      : [],
  }
}

async function writeStage(
  options: CodegenOptions,
  key: string,
  status: 'running' | 'succeeded' | 'failed',
  attempt: number,
  fingerprint: string,
  payload: unknown,
): Promise<void> {
  if (!options.store || !options.runDir) return
  await options.store.writeStage(options.runDir, { key, status, attempt, fingerprint, payload })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
