import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { AiProviderError, type AiClient } from '../ai/openai-compatible'
import { completeJsonWithRepair } from '../ai/structured-output'
import { SCRIPT_VIDEO_SCHEMA_VERSION, scriptVideoInputSchema, type ScriptVideoInput } from '../contracts'
import { SafeCliError } from '../safe-error'
import { registerFileArtifact } from '../state/artifacts'
import type { StateStore } from '../state/store'
import { buildSemanticIngestPrompt, hashPromptAssets } from './prompts'

const semanticUnitSchema = z
  .object({
    id: z.string().regex(/^U\d{3}$/u),
    from: z.string().regex(/^A\d{3,6}$/u),
    to: z.string().regex(/^A\d{3,6}$/u),
    order: z.number().int().nonnegative(),
  })
  .strict()

export interface SemanticSourceAtom {
  id: string
  text: string
  start: number
  end: number
}

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
  const atoms = atomizeSemanticSource(sourceText)
  if (atoms.length === 0) {
    throw new SafeCliError('SEMANTIC_SOURCE_EMPTY', '文稿中没有可拆分的有效文本。', false, 422, {
      stageKey: 'INGEST_SEMANTIC',
    })
  }
  const schema = semanticResultSchema(atoms)
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({ semanticIngestVersion: 2, sourceText, base, prompt: hashPromptAssets(['semantic-ingest']) }),
      'utf8',
    )
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
    const prompt = buildSemanticIngestPrompt(atoms.map(({ id, text }) => ({ id, text })))
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
      units: result.units.map((unit) => ({
        id: unit.id,
        text: materializeUnitText(sourceText, atoms, unit.from, unit.to),
        visualIntent: 'show',
      })),
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
    const semanticError = normalizeSemanticError(error)
    await options.store.writeStage(options.runDir, {
      key: 'INGEST_SEMANTIC',
      status: 'failed',
      attempt,
      fingerprint,
      payload: { code: safeErrorCode(semanticError) },
    })
    throw semanticError
  }
}

export function atomizeSemanticSource(sourceText: string): SemanticSourceAtom[] {
  const atoms: SemanticSourceAtom[] = []
  const boundaries = new Set(['\n', '。', '！', '？', '；', '：', '，', '!', '?', ';', ','])
  let start = 0
  let offset = 0

  const append = (end: number) => {
    const raw = sourceText.slice(start, end)
    if (/\S/u.test(raw)) {
      atoms.push({ id: `A${String(atoms.length + 1).padStart(3, '0')}`, text: raw.trim(), start, end })
    }
    start = end
  }

  for (const character of sourceText) {
    offset += character.length
    if (boundaries.has(character)) append(offset)
  }
  if (start < sourceText.length) append(sourceText.length)
  return atoms
}

export function semanticResultSchema(sourceOrAtoms: string | readonly SemanticSourceAtom[]) {
  const atoms = typeof sourceOrAtoms === 'string' ? atomizeSemanticSource(sourceOrAtoms) : sourceOrAtoms
  return z
    .object({ units: z.array(semanticUnitSchema).min(1).max(128) })
    .strict()
    .superRefine((value, context) => validateSemanticCoverage(atoms, value.units, context))
}

function validateSemanticCoverage(
  atoms: readonly SemanticSourceAtom[],
  units: Array<z.infer<typeof semanticUnitSchema>>,
  context: z.RefinementCtx,
): void {
  const atomIndexes = new Map(atoms.map((atom, index) => [atom.id, index]))
  let expectedAtomIndex = 0
  units.forEach((unit, index) => {
    const expectedId = `U${String(index + 1).padStart(3, '0')}`
    if (unit.id !== expectedId) context.addIssue({ code: 'custom', path: ['units', index, 'id'], message: 'ID 不连续' })
    if (unit.order !== index)
      context.addIssue({ code: 'custom', path: ['units', index, 'order'], message: 'order 不连续' })
    const fromIndex = atomIndexes.get(unit.from)
    const toIndex = atomIndexes.get(unit.to)
    if (fromIndex === undefined || toIndex === undefined) {
      context.addIssue({ code: 'custom', path: ['units', index], message: '引用了不存在的原子 ID' })
      return
    }
    if (fromIndex > toIndex) {
      context.addIssue({ code: 'custom', path: ['units', index], message: '原子范围倒序' })
      return
    }
    if (fromIndex !== expectedAtomIndex) {
      context.addIssue({ code: 'custom', path: ['units', index, 'from'], message: '原子范围存在遗漏或重叠' })
    }
    expectedAtomIndex = toIndex + 1
  })
  if (expectedAtomIndex !== atoms.length)
    context.addIssue({ code: 'custom', path: ['units'], message: '原子范围未完整覆盖原文' })
}

function materializeUnitText(
  sourceText: string,
  atoms: readonly SemanticSourceAtom[],
  from: string,
  to: string,
): string {
  const fromAtom = atoms.find((atom) => atom.id === from)
  const toAtom = atoms.find((atom) => atom.id === to)
  if (!fromAtom || !toAtom) throw new Error('SEMANTIC_ATOM_RANGE_INVALID')
  return sourceText.slice(fromAtom.start, toAtom.end).trim()
}

function normalizeSemanticError(error: unknown): unknown {
  if (error instanceof AiProviderError && error.code === 'AI_OUTPUT_INVALID') {
    return new SafeCliError('SEMANTIC_OUTPUT_INVALID', '语义拆稿结果无效，可以安全重试。', true, 422, {
      stageKey: 'INGEST_SEMANTIC',
    })
  }
  return error
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
