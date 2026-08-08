import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { AiClient } from '../ai/openai-compatible'
import { completeJsonWithRepair } from '../ai/structured-output'
import { SCRIPT_VIDEO_SCHEMA_VERSION, scriptVideoInputSchema, type ScriptVideoInput } from '../contracts'
import { registerFileArtifact } from '../state/artifacts'
import type { StateStore } from '../state/store'
import { buildSemanticIngestPrompt, hashPromptAssets } from './prompts'

const semanticUnitSchema = z
  .object({
    id: z.string().regex(/^U\d{3}$/u),
    text: z.string().refine((value) => value.trim().length > 0, 'unit text 不能为空'),
    order: z.number().int().nonnegative(),
  })
  .strict()

export interface SemanticIngestOptions {
  store: StateStore
  runDir: string
  signal?: AbortSignal
}

export async function semanticIngestMarkdown(
  base: ScriptVideoInput,
  sourceText: string,
  ai: AiClient,
  options: SemanticIngestOptions,
): Promise<ScriptVideoInput> {
  const schema = semanticResultSchema(sourceText)
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ sourceText, base, prompt: hashPromptAssets(['semantic-ingest']) }), 'utf8')
    .digest('hex')
  const outputPath = join(options.runDir, 'input', 'semantic-script.json')
  const previous = await options.store.readStage(options.runDir, 'INGEST_SEMANTIC')
  if (previous?.status === 'succeeded' && previous.fingerprint === fingerprint) {
    const cached = await readCachedInput(outputPath)
    if (cached) return cached
  }

  const attempt = (previous?.attempt ?? 0) + 1
  await options.store.writeStage(options.runDir, {
    key: 'INGEST_SEMANTIC',
    status: 'running',
    attempt,
    fingerprint,
    payload: {},
  })
  try {
    const prompt = buildSemanticIngestPrompt(sourceText)
    const result = await completeJsonWithRepair({
      ai,
      schema,
      stage: 'SEMANTIC_INGEST',
      prompt: { ...prompt, signal: options.signal },
      preserveFullPromptOnRepair: true,
    })
    const input = scriptVideoInputSchema.parse({
      ...base,
      schemaVersion: SCRIPT_VIDEO_SCHEMA_VERSION,
      units: result.units.map((unit) => ({ id: unit.id, text: unit.text.trim(), visualIntent: 'show' })),
    })
    await mkdir(join(options.runDir, 'input'), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
    await registerFileArtifact(options.store, options.runDir, {
      id: 'semantic-script',
      kind: 'application/json',
      path: outputPath,
    })
    await options.store.writeStage(options.runDir, {
      key: 'INGEST_SEMANTIC',
      status: 'succeeded',
      attempt,
      fingerprint,
      artifactIds: ['semantic-script'],
      payload: { scriptPath: outputPath, unitCount: input.units.length },
    })
    return input
  } catch (error) {
    await options.store.writeStage(options.runDir, {
      key: 'INGEST_SEMANTIC',
      status: 'failed',
      attempt,
      fingerprint,
      payload: { code: safeErrorCode(error) },
    })
    throw error
  }
}

export function semanticResultSchema(sourceText: string) {
  return z
    .object({ units: z.array(semanticUnitSchema).min(1).max(999) })
    .strict()
    .superRefine((value, context) => validateSemanticCoverage(sourceText, value.units, context))
}

function validateSemanticCoverage(
  sourceText: string,
  units: Array<z.infer<typeof semanticUnitSchema>>,
  context: z.RefinementCtx,
): void {
  let cursor = 0
  units.forEach((unit, index) => {
    const expectedId = `U${String(index + 1).padStart(3, '0')}`
    if (unit.id !== expectedId) context.addIssue({ code: 'custom', path: ['units', index, 'id'], message: 'ID 不连续' })
    if (unit.order !== index)
      context.addIssue({ code: 'custom', path: ['units', index, 'order'], message: 'order 不连续' })
    const start = sourceText.indexOf(unit.text, cursor)
    if (start < 0) {
      context.addIssue({ code: 'custom', path: ['units', index, 'text'], message: 'text 不是原文中的连续文本' })
      return
    }
    if (/\S/u.test(sourceText.slice(cursor, start))) {
      context.addIssue({ code: 'custom', path: ['units', index, 'text'], message: 'unit 之间遗漏了原文' })
    }
    cursor = start + unit.text.length
  })
  if (/\S/u.test(sourceText.slice(cursor)))
    context.addIssue({ code: 'custom', path: ['units'], message: '末尾原文未覆盖' })
}

async function readCachedInput(path: string): Promise<ScriptVideoInput | null> {
  try {
    return scriptVideoInputSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
  } catch {
    return null
  }
}

function safeErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'AI_PROVIDER_ERROR'
}
