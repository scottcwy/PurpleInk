import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, access, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'

import type { AiClient } from '../ai/openai-compatible'
import { mapWithConcurrency } from '../ai/concurrency'
import type { ScriptVideoInput, ShotPlan } from '../contracts'
import type { StateStore } from '../state/store'
import { registerFileArtifact } from '../state/artifacts'
import { runChromiumGate, validateShotHtml, type RuntimeGateResult } from './gates'
import { buildFabricatePrompt, buildHtmlRepairPrompt, hashPromptAssets } from './prompts'

const require = createRequire(import.meta.url)
const localGsapSource = readFileSync(require.resolve('gsap/dist/gsap.min.js'), 'utf8')

export interface CodegenOptions {
  ai: AiClient
  outputDir: string
  concurrency: number
  runtimeGate?: (htmlPath: string, attemptDir?: string) => Promise<RuntimeGateResult>
  store?: StateStore
  runDir?: string
  signal?: AbortSignal
  forceShotIds?: ReadonlySet<string>
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
    async (shot, _index, signal) => generateOneShot(input, shot, { ...options, signal }),
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
  const promptFingerprint = hashPromptAssets(['fabricate', 'html-repair'])
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ input, shot, promptFingerprint, htmlAdapterVersion: 3 }), 'utf8')
    .digest('hex')
  const key = `FABRICATE:${shot.id}`
  const previous = options.store && options.runDir ? await options.store.readStage(options.runDir, key) : null
  const previousResult = previous?.status === 'succeeded' ? parseStoredResult(previous.payload) : null
  if (
    !options.forceShotIds?.has(shot.id) &&
    previous &&
    previous.fingerprint === fingerprint &&
    previousResult?.status === 'succeeded'
  ) {
    const storedPath = resolve(options.outputDir, previousResult.relativeHtmlPath ?? '')
    if (previousResult.relativeHtmlPath && (await exists(storedPath))) return previousResult
  }

  const firstAttempt = (previous?.attempt ?? 0) + 1
  const unit = input.units.find((candidate) => candidate.id === shot.sourceUnitId)
  if (!unit) return failedResult(shot, firstAttempt, 'SHOT_OUTPUT_INVALID')
  let lastError = 'SHOT_OUTPUT_INVALID'
  for (let offset = 0; offset < 2; offset += 1) {
    const attempt = firstAttempt + offset
    await writeStage(options, key, 'running', attempt, fingerprint, {})
    try {
      const prompt =
        offset === 0 ? buildFabricatePrompt(input, unit, shot) : buildHtmlRepairPrompt(shot, compactError(lastError))
      const raw = await options.ai.completeText({ ...prompt, signal: options.signal })
      const html = normalizeHtml(raw, shot.durationSec)
      const shotDir = join(options.outputDir, 'shots', shot.id, `attempt-${String(attempt).padStart(3, '0')}`)
      await mkdir(shotDir, { recursive: true })
      const htmlPath = join(shotDir, 'source.html')
      await writeFile(htmlPath, `${html}\n`, 'utf8')
      const staticGate = validateShotHtml(html)
      if (!staticGate.passed) {
        lastError = `SHOT_GATE_FAILED:${staticGate.errors.join(',')}`
        const diagnosticsPath = join(shotDir, 'diagnostics.json')
        await writeFile(
          diagnosticsPath,
          `${JSON.stringify({ schemaVersion: 1, diagnostics: staticGate.errors.map((message) => ({ type: 'static', message })) }, null, 2)}\n`,
          'utf8',
        )
        await registerFailedAttemptArtifacts(options, shot.id, attempt, htmlPath, { diagnosticsPath })
        await writeStage(options, key, 'failed', attempt, fingerprint, { errorCode: 'SHOT_GATE_FAILED' })
        continue
      }
      const browserKey = `BROWSER_QA:${shot.id}`
      await writeStage(options, browserKey, 'running', attempt, fingerprint, {})
      const runtime = options.runtimeGate
        ? await options.runtimeGate(htmlPath, shotDir)
        : await runChromiumGate(htmlPath, { outputDir: shotDir })
      if (!runtime.passed) {
        lastError = runtime.errors[0] ?? 'BROWSER_GATE_FAILED'
        await registerFailedAttemptArtifacts(options, shot.id, attempt, htmlPath, runtime)
        await writeStage(options, browserKey, 'failed', attempt, fingerprint, { errorCode: lastError })
        continue
      }
      const artifactIds = await registerShotArtifacts(options, shot.id, htmlPath, runtime)
      const result: CodegenShotResult = {
        id: shot.id,
        sourceUnitId: shot.sourceUnitId,
        status: 'succeeded',
        attempt,
        relativeHtmlPath: relative(options.outputDir, htmlPath),
        screenshotHashes: runtime.screenshotHashes,
      }
      await writeStage(
        options,
        key,
        'succeeded',
        attempt,
        fingerprint,
        result,
        artifactIds.filter((id) => id.endsWith('-html')),
      )
      await writeStage(
        options,
        browserKey,
        'succeeded',
        attempt,
        fingerprint,
        { screenshotHashes: runtime.screenshotHashes },
        artifactIds.filter((id) => !id.endsWith('-html')),
      )
      return result
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (!(error instanceof CodegenFailure) || error.code === 'AI_PROVIDER_ERROR') {
        const result = failedResult(shot, attempt, 'AI_PROVIDER_ERROR')
        await writeStage(options, key, 'failed', attempt, fingerprint, result)
        return result
      }
      lastError = error.code
    }
  }
  const errorCode = lastError.startsWith('BROWSER_') ? 'BROWSER_GATE_FAILED' : 'SHOT_GATE_FAILED'
  const result = failedResult(shot, firstAttempt + 1, errorCode)
  await writeStage(options, key, 'failed', result.attempt, fingerprint, result)
  return result
}

class CodegenFailure extends Error {
  constructor(readonly code: NonNullable<CodegenShotResult['errorCode']>) {
    super(code)
    this.name = 'CodegenFailure'
  }
}

function normalizeHtml(raw: string, durationSec: number): string {
  const fenced = raw.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/iu)
  const html = (fenced?.[1] ?? raw).trim()
  if (!/<html[\s>]/iu.test(html) || !/<\/body\s*>/iu.test(html) || !/<\/html\s*>/iu.test(html)) {
    throw new CodegenFailure('SHOT_OUTPUT_INVALID')
  }
  let normalized = html
    .replace(/font-family\s*:\s*[^;}]+/giu, 'font-family: Inter, sans-serif')
  normalized = injectLocalGsap(normalized)
  if (
    /window\.__PURPLEINK_RENDER__/u.test(normalized) &&
    /ready\s*:\s*true/u.test(normalized) &&
    /durationSec\s*:/u.test(normalized)
  ) {
    return normalized
  }
  const adapter = `<script>
(function () {
  const original = window.__PURPLEINK_RENDER__;
  const durationSec = ${Number(durationSec.toFixed(3))};
  window.__PURPLEINK_RENDER__ = {
    ready: true,
    durationSec: durationSec,
    seek: function (progress) {
      const value = Math.max(0, Math.min(1, Number(progress) || 0));
      if (typeof original === 'function') return original(value);
      if (original && typeof original.seek === 'function') return original.seek(value * durationSec);
      if (original && typeof original.seekTo === 'function') return original.seekTo(value * durationSec);
      if (original && typeof original.render === 'function') return original.render(value * durationSec);
      if (typeof window.renderAtProgress === 'function') return window.renderAtProgress(value);
      if (typeof window.renderFrame === 'function') return window.renderFrame(value * durationSec);
    }
  };
})();
</script>`
  normalized = appendBeforeBody(normalized, adapter)
  return normalized
}

function injectLocalGsap(html: string): string {
  if (/data-purpleink-runtime=["']gsap["']/iu.test(html)) return html
  const script = `<script data-purpleink-runtime="gsap">${localGsapSource}</script>`
  if (/<head\b[^>]*>/iu.test(html)) return html.replace(/<head\b[^>]*>/iu, (opening) => `${opening}\n${script}`)
  return html.replace(/<html\b[^>]*>/iu, (opening) => `${opening}\n<head>${script}</head>`)
}

function appendBeforeBody(html: string, content: string): string {
  return content.trim() ? html.replace(/<\/body\s*>/iu, `${content}\n</body>`) : html
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
  artifactIds?: string[],
): Promise<void> {
  if (!options.store || !options.runDir) return
  await options.store.writeStage(options.runDir, {
    key,
    status,
    attempt,
    fingerprint,
    payload,
    ...(artifactIds?.length ? { artifactIds } : {}),
  })
}

async function registerShotArtifacts(
  options: CodegenOptions,
  shotId: string,
  htmlPath: string,
  runtime: RuntimeGateResult,
): Promise<string[]> {
  if (!options.store || !options.runDir) return []
  const artifacts = [{ id: `shot-${shotId}-html`, kind: 'text/html', path: htmlPath }]
  for (const [index, path] of (runtime.screenshotPaths ?? []).entries()) {
    artifacts.push({
      id: `shot-${shotId}-screenshot-${['000', '050', '100'][index] ?? index}`,
      kind: 'image/png',
      path,
    })
  }
  if (runtime.diagnosticsPath) {
    artifacts.push({ id: `shot-${shotId}-diagnostics`, kind: 'application/json', path: runtime.diagnosticsPath })
  }
  await Promise.all(artifacts.map((artifact) => registerFileArtifact(options.store!, options.runDir!, artifact)))
  return artifacts.map((artifact) => artifact.id)
}

async function registerFailedAttemptArtifacts(
  options: CodegenOptions,
  shotId: string,
  attempt: number,
  htmlPath: string,
  runtime: Pick<RuntimeGateResult, 'screenshotPaths' | 'diagnosticsPath'>,
): Promise<void> {
  if (!options.store || !options.runDir) return
  const suffix = `attempt-${String(attempt).padStart(3, '0')}`
  const artifacts = [{ id: `shot-${shotId}-${suffix}-html`, kind: 'text/html', path: htmlPath }]
  for (const [index, path] of (runtime.screenshotPaths ?? []).entries()) {
    artifacts.push({
      id: `shot-${shotId}-${suffix}-screenshot-${['000', '050', '100'][index] ?? index}`,
      kind: 'image/png',
      path,
    })
  }
  if (runtime.diagnosticsPath) {
    artifacts.push({
      id: `shot-${shotId}-${suffix}-diagnostics`,
      kind: 'application/json',
      path: runtime.diagnosticsPath,
    })
  }
  await Promise.all(artifacts.map((artifact) => registerFileArtifact(options.store!, options.runDir!, artifact)))
}

function failedResult(
  shot: ShotPlan,
  attempt: number,
  errorCode: NonNullable<CodegenShotResult['errorCode']>,
): CodegenShotResult {
  return { id: shot.id, sourceUnitId: shot.sourceUnitId, status: 'failed', attempt, errorCode }
}

function compactError(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500)
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
