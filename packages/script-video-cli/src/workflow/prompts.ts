import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DirectorPlan, ScriptUnit, ScriptVideoInput, ShotPlan } from '../contracts'

export const PROMPT_ASSET_NAMES = [
  'semantic-ingest',
  'global-constraints',
  'direct',
  'shot-spec',
  'fabricate',
  'asr-segment',
  'transcript-structure',
  'tts-style',
  'json-repair',
  'html-repair',
] as const

export type PromptAssetName = (typeof PROMPT_ASSET_NAMES)[number]

export interface PromptAsset {
  system: string
  user: string
  sha256: string
}

export interface PromptAssetOptions {
  rootDir?: string
}

export function loadPromptAsset(name: PromptAssetName, options: PromptAssetOptions = {}): PromptAsset {
  const bytes = readFileSync(resolve(options.rootDir ?? defaultPromptRoot(), `${name}.md`))
  const source = bytes.toString('utf8').replace(/\r\n?/gu, '\n')
  if (source.includes('\uFFFD')) throw new Error(`PROMPT_ENCODING_INVALID:${name}`)
  const sections = source.match(/^--- system ---\n([\s\S]*?)\n--- user ---\n([\s\S]*?)\s*$/u)
  if (!sections?.[1]?.trim() || !sections[2]?.trim()) throw new Error(`PROMPT_ASSET_INVALID:${name}`)
  return {
    system: sections[1].trim(),
    user: sections[2].trim(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function hashPromptAssets(names: readonly PromptAssetName[], options: PromptAssetOptions = {}): string {
  const hash = createHash('sha256')
  for (const name of names) hash.update(`${name}:${loadPromptAsset(name, options).sha256}\n`, 'utf8')
  return hash.digest('hex')
}

export function hashPromptAssetsWithGlobal(
  names: readonly PromptAssetName[],
  globalPrompt?: string,
  options: PromptAssetOptions = {},
): string {
  return hashPromptAssets(globalPrompt?.trim() ? [...names, 'global-constraints'] : names, options)
}

export function renderPromptAsset(
  name: PromptAssetName,
  variables: Readonly<Record<string, string>>,
  options: PromptAssetOptions = {},
): PromptAsset {
  const asset = loadPromptAsset(name, options)
  return {
    ...asset,
    system: interpolate(asset.system, variables, name),
    user: interpolate(asset.user, variables, name),
  }
}

export function buildDirectPrompt(input: ScriptVideoInput): { system: string; user: string } {
  return appendGlobalPrompt(
    pickPrompt(
      renderPromptAsset('direct', {
        title: input.title,
        visualStyle: input.visualStyle,
        unitsJson: JSON.stringify(input.units),
      }),
    ),
    input.globalPrompt,
  )
}

export function buildSemanticIngestPrompt(sourceText: string): { system: string; user: string } {
  return pickPrompt(renderPromptAsset('semantic-ingest', { sourceJson: JSON.stringify(sourceText) }))
}

export function buildShotSpecPrompt(
  input: ScriptVideoInput,
  director: DirectorPlan,
  unit: ScriptUnit,
  expectedId: string,
): { system: string; user: string } {
  return appendGlobalPrompt(
    pickPrompt(
      renderPromptAsset('shot-spec', {
        expectedId,
        directorJson: JSON.stringify(director),
        unitJson: JSON.stringify(unit),
        inputSummaryJson: JSON.stringify({ title: input.title, language: input.language }),
      }),
    ),
    input.globalPrompt,
  )
}

export function buildFabricatePrompt(
  input: ScriptVideoInput,
  unit: ScriptUnit,
  shot: ShotPlan,
): { system: string; user: string } {
  return appendGlobalPrompt(
    pickPrompt(
      renderPromptAsset('fabricate', {
        shotId: shot.id,
        inputSummaryJson: JSON.stringify({ title: input.title, visualStyle: input.visualStyle }),
        unitJson: JSON.stringify(unit),
        shotJson: JSON.stringify(shot),
      }),
    ),
    input.globalPrompt,
  )
}

export function buildTranscriptStructurePrompt(
  segments: readonly { id: string; startMs: number; endMs: number; text: string }[],
): { system: string; user: string } {
  return pickPrompt(renderPromptAsset('transcript-structure', { segmentsJson: JSON.stringify(segments) }))
}

export function buildTtsStylePrompt(
  input: Pick<ScriptVideoInput, 'language' | 'visualStyle'>,
  shot: Pick<ShotPlan, 'purpose'>,
): string {
  const prompt = renderPromptAsset('tts-style', {
    language: input.language,
    visualStyle: input.visualStyle,
    purpose: shot.purpose,
  })
  return `${prompt.system}\n${prompt.user}`.trim()
}

export function buildHtmlRepairPrompt(
  shot: ShotPlan,
  errorSummary: string,
  globalPrompt?: string,
): { system: string; user: string } {
  return appendGlobalPrompt(
    pickPrompt(
      renderPromptAsset('html-repair', {
        shotId: shot.id,
        errorSummary,
        shotJson: JSON.stringify(shot),
      }),
    ),
    globalPrompt,
  )
}

function appendGlobalPrompt(
  prompt: { system: string; user: string },
  globalPrompt?: string,
): { system: string; user: string } {
  if (!globalPrompt?.trim()) return prompt
  const constraints = renderPromptAsset('global-constraints', { globalPrompt: globalPrompt.trim() })
  return {
    system: `${prompt.system}\n\n${constraints.system}`,
    user: `${prompt.user}\n\n${constraints.user}`,
  }
}

function defaultPromptRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../prompts')
}

function interpolate(source: string, variables: Readonly<Record<string, string>>, name: PromptAssetName): string {
  const rendered = source.replace(/\{\{([a-zA-Z0-9]+)\}\}/gu, (_match, key: string) => variables[key] ?? '')
  if (/\{\{[^}]+\}\}/u.test(rendered)) throw new Error(`PROMPT_VARIABLE_MISSING:${name}`)
  return rendered
}

function pickPrompt(asset: PromptAsset): { system: string; user: string } {
  return { system: asset.system, user: asset.user }
}
