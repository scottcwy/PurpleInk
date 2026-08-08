import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, join, dirname, isAbsolute, sep } from 'node:path'

import type { NarrationMode, ScriptVideoInput, ShotPlan } from '../contracts'
import type { CodegenResult, CodegenShotResult } from './codegen'

export interface TtsAdapter {
  synthesize(request: { text: string; language: string; title: string; signal?: AbortSignal }): Promise<Uint8Array>
}

export interface NarrationOptions {
  mode: NarrationMode
  tts?: TtsAdapter
  format?: 'wav' | 'mp3'
  signal?: AbortSignal
}

export interface AssemblyOptions {
  outputDir: string
  narration: NarrationOptions
}

export interface NarrationResult {
  mode: NarrationMode
  status: 'off' | 'ready' | 'degraded'
  relativeAudioPath?: string
  reason?: 'TTS_NOT_CONFIGURED' | 'TTS_FAILED'
}

export interface AssemblyResult {
  projectDir: string
  indexPath: string
  manifestPath: string
  subtitlePath: string
  durationSec: number
  narration: NarrationResult
}

export class AssemblyError extends Error {
  constructor(readonly code: 'SHOT_GATE_REQUIRED' | 'TTS_CONFIG_INVALID' | 'TTS_PROVIDER_ERROR', message: string) {
    super(message)
    this.name = 'AssemblyError'
  }
}

export async function assembleProject(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  codegen: CodegenResult,
  options: AssemblyOptions,
): Promise<AssemblyResult> {
  if (codegen.failed.length > 0 || codegen.succeeded.length !== plans.length) {
    throw new AssemblyError('SHOT_GATE_REQUIRED', '存在未通过 gate 的镜头，不能合成视频')
  }
  const resultById = new Map(codegen.succeeded.map((shot) => [shot.id, shot]))
  const projectDir = join(resolve(options.outputDir), 'project')
  const compositionDir = join(projectDir, 'compositions')
  await mkdir(compositionDir, { recursive: true })
  const durationSec = round(plans.reduce((total, plan) => total + plan.durationSec, 0))
  const compositionPaths: string[] = []

  for (const plan of plans) {
    const shot = resultById.get(plan.id)
    if (!shot?.relativeHtmlPath) throw new AssemblyError('SHOT_GATE_REQUIRED', `镜头 ${plan.id} 缺少已通过 gate 的 HTML`)
    const sourcePath = resolveInside(resolve(options.outputDir), shot.relativeHtmlPath)
    const compositionPath = join(compositionDir, `${plan.id}.html`)
    await copyFile(sourcePath, compositionPath)
    compositionPaths.push(`compositions/${plan.id}.html`)
  }

  const narration = await prepareNarration(input, plans, projectDir, options.narration)
  const indexPath = join(projectDir, 'index.html')
  const manifestPath = join(projectDir, 'manifest.json')
  const subtitlePath = join(projectDir, 'subtitles.srt')
  await writeFile(indexPath, createIndexHtml(input, plans, compositionPaths, durationSec), 'utf8')
  await writeFile(subtitlePath, createSubtitles(input, plans), 'utf8')
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'purpleink-script-video-project',
    title: input.title,
    language: input.language,
    durationSec,
    narration,
    shots: plans.map((plan, index) => ({
      id: plan.id,
      sourceUnitId: plan.sourceUnitId,
      durationSec: plan.durationSec,
      compositionPath: compositionPaths[index],
    })),
  }, null, 2) + '\n', 'utf8')

  return { projectDir, indexPath, manifestPath, subtitlePath, durationSec, narration }
}

async function prepareNarration(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  projectDir: string,
  options: NarrationOptions,
): Promise<NarrationResult> {
  if (options.mode === 'off') return { mode: 'off', status: 'off' }
  if (!options.tts) {
    if (options.mode === 'required') throw new AssemblyError('TTS_CONFIG_INVALID', 'required narration 没有配置用户自有 TTS adapter')
    return { mode: options.mode, status: 'degraded', reason: 'TTS_NOT_CONFIGURED' }
  }
  try {
    const audio = await options.tts.synthesize({
      text: input.units.map((unit) => unit.text).join('\n'),
      language: input.language,
      title: input.title,
      signal: options.signal,
    })
    if (audio.byteLength === 0) throw new Error('empty audio')
    const format = options.format ?? 'wav'
    const relativeAudioPath = `assets/narration.${format}`
    const audioPath = join(projectDir, relativeAudioPath)
    await mkdir(dirname(audioPath), { recursive: true })
    await writeFile(audioPath, audio)
    return { mode: options.mode, status: 'ready', relativeAudioPath }
  } catch {
    if (options.mode === 'required') throw new AssemblyError('TTS_PROVIDER_ERROR', 'required narration provider failed')
    return { mode: options.mode, status: 'degraded', reason: 'TTS_FAILED' }
  }
}

function createIndexHtml(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  compositionPaths: readonly string[],
  durationSec: number,
): string {
  let start = 0
  const hosts = plans.map((plan, index) => {
    const host = `    <div data-composition-id="host-${plan.id}" data-composition-src="${compositionPaths[index]}" data-start="${round(start)}" data-duration="${round(plan.durationSec)}" data-width="1920" data-height="1080"></div>`
    start += plan.durationSec
    return host
  }).join('\n')
  return `<!doctype html>
<html lang="${escapeAttribute(input.language)}" data-resolution="landscape">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920,height=1080">
  <title>${escapeHtml(input.title)}</title>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1020;color:#f5f7ff}#root{width:1920px;height:1080px}</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${durationSec}" data-width="1920" data-height="1080">
${hosts}
  </div>
</body>
</html>
`
}

function createSubtitles(input: ScriptVideoInput, plans: readonly ShotPlan[]): string {
  let start = 0
  return plans.map((plan, index) => {
    const unit = input.units.find((candidate) => candidate.id === plan.sourceUnitId)
    const block = `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(start + plan.durationSec)}\n${unit?.text ?? plan.onScreenText.join(' ')}\n`
    start += plan.durationSec
    return block
  }).join('\n')
}

function formatSrtTime(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(millis / 3_600_000)
  const minutes = Math.floor((millis % 3_600_000) / 60_000)
  const secs = Math.floor((millis % 60_000) / 1000)
  const remainder = millis % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(remainder).padStart(3, '0')}`
}

function pad(value: number): string { return String(value).padStart(2, '0') }
function round(value: number): number { return Math.round(value * 1000) / 1000 }
function escapeAttribute(value: string): string { return escapeHtml(value).replace(/"/gu, '&quot;') }
function escapeHtml(value: string): string { return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;') }

function resolveInside(root: string, child: string): string {
  const resolved = resolve(root, child)
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`
  if (resolved !== root && !resolved.startsWith(rootWithSep)) throw new AssemblyError('SHOT_GATE_REQUIRED', '镜头路径越过运行目录')
  return resolved
}
