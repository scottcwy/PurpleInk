import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { z } from 'zod'

import type { AiClient } from '../ai/openai-compatible'
import { completeJsonWithRepair } from '../ai/structured-output'
import { mapWithConcurrency } from '../ai/concurrency'
import { SCRIPT_VIDEO_SCHEMA_VERSION, scriptVideoInputSchema, type ScriptVideoInput } from '../contracts'
import { readScriptFile } from '../input'
import { cutAudioSegment, detectSpeechSegments, normalizeAudio } from '../media/ffmpeg'
import { SafeCliError } from '../safe-error'
import { registerFileArtifact } from '../state/artifacts'
import type { StateStore } from '../state/store'
import { buildTranscriptStructurePrompt, hashPromptAssets } from '../workflow/prompts'
import type { MimoSpeechClient, SpeechAudioMimeType } from './mimo-client'

const transcriptUnitSchema = z
  .object({
    id: z.string().regex(/^U\d{3}$/u),
    text: z.string().trim().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    visualIntent: z.string().trim().min(1).max(48),
  })
  .strict()

const structuredTranscriptSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    language: z.string().trim().min(2).max(24),
    units: z.array(transcriptUnitSchema).min(1),
  })
  .strict()

export interface TranscriptSegment {
  id: string
  startMs: number
  endMs: number
  text: string
  audioPath: string
}

export interface TranscriptionResult {
  input: ScriptVideoInput
  transcriptJsonPath: string
  transcriptMarkdownPath: string
  scriptPath: string
  normalizedAudioPath: string
  segments: TranscriptSegment[]
}

export interface TranscriptionOptions {
  outputDir: string
  ai: AiClient
  speech: MimoSpeechClient
  concurrency: number
  store: StateStore
  runDir: string
  signal?: AbortSignal
}

export async function transcribeAudio(sourcePath: string, options: TranscriptionOptions): Promise<TranscriptionResult> {
  const inputDir = join(options.outputDir, 'input')
  const segmentDir = join(inputDir, 'segments')
  const normalizedAudioPath = join(inputDir, 'normalized.wav')
  const logPath = join(options.outputDir, 'logs', 'asr-ffmpeg.log')
  await mkdir(segmentDir, { recursive: true })
  const fingerprint = createHash('sha256')
    .update(await readFile(sourcePath))
    .update(hashPromptAssets(['asr-segment', 'transcript-structure']))
    .digest('hex')
  const previous = await options.store.readStage(options.runDir, 'ASR')
  if (previous?.status === 'succeeded' && previous.fingerprint === fingerprint) {
    const cached = await readCachedResult(inputDir, normalizedAudioPath)
    if (cached) return cached
  }
  const attempt = (previous?.attempt ?? 0) + 1
  await options.store.writeStage(options.runDir, { key: 'ASR', status: 'running', attempt, fingerprint, payload: {} })
  try {
    await normalizeAudio(sourcePath, normalizedAudioPath, { logPath, signal: options.signal })
    const boundaries = await detectSpeechSegments(normalizedAudioPath, { logPath, signal: options.signal })
    if (boundaries.length === 0) throw new SafeCliError('ASR_NO_SPEECH', '音频中没有检测到有效语音。', false, 422)
    const segments = await mapWithConcurrency(
      boundaries,
      options.concurrency,
      async (boundary, index) => {
        const id = `U${String(index + 1).padStart(3, '0')}`
        const audioPath = join(segmentDir, `${id}.wav`)
        await cutAudioSegment(normalizedAudioPath, audioPath, boundary, { logPath, signal: options.signal })
        const audio = await readFile(audioPath)
        const result = await options.speech.transcribe({
          audio,
          mimeType: audioMimeType(audioPath),
          language: 'auto',
          signal: options.signal,
        })
        return { id, ...boundary, text: result.text.trim(), audioPath }
      },
      { signal: options.signal },
    )
    const prompt = buildTranscriptStructurePrompt(segments)
    const structured = await completeJsonWithRepair({
      ai: options.ai,
      schema: structuredTranscriptSchema,
      stage: 'TRANSCRIPT_STRUCTURE',
      prompt: { ...prompt, signal: options.signal },
    })
    const units = bindRealTimestamps(structured.units, segments)
    const durationSec = Math.max(5, Math.min(600, Math.ceil((segments.at(-1)?.endMs ?? 5_000) / 1000)))
    const input = scriptVideoInputSchema.parse({
      schemaVersion: SCRIPT_VIDEO_SCHEMA_VERSION,
      title: structured.title,
      language: structured.language,
      durationSec,
      visualStyle: 'editorial technical',
      narration: 'auto',
      units,
    })
    const transcriptJsonPath = join(inputDir, 'transcript.json')
    const transcriptMarkdownPath = join(inputDir, 'transcript.md')
    const scriptPath = join(inputDir, 'script.json')
    await writeFile(
      transcriptJsonPath,
      `${JSON.stringify({ schemaVersion: 1, source: basename(sourcePath), segments }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(transcriptMarkdownPath, renderTranscriptMarkdown(input.title, segments), 'utf8')
    await writeFile(scriptPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
    await Promise.all([
      registerFileArtifact(options.store, options.runDir, {
        id: 'transcript-json',
        kind: 'application/json',
        path: transcriptJsonPath,
      }),
      registerFileArtifact(options.store, options.runDir, {
        id: 'transcript-markdown',
        kind: 'text/markdown',
        path: transcriptMarkdownPath,
      }),
      registerFileArtifact(options.store, options.runDir, {
        id: 'normalized-script',
        kind: 'application/json',
        path: scriptPath,
      }),
      registerFileArtifact(options.store, options.runDir, {
        id: 'normalized-audio',
        kind: 'audio/wav',
        path: normalizedAudioPath,
      }),
    ])
    await options.store.writeStage(options.runDir, {
      key: 'ASR',
      status: 'succeeded',
      attempt,
      fingerprint,
      artifactIds: ['transcript-json', 'transcript-markdown', 'normalized-script', 'normalized-audio'],
      payload: { scriptPath, segmentCount: segments.length },
    })
    return { input, transcriptJsonPath, transcriptMarkdownPath, scriptPath, normalizedAudioPath, segments }
  } catch (error) {
    await options.store.writeStage(options.runDir, {
      key: 'ASR',
      status: 'failed',
      attempt,
      fingerprint,
      payload: { code: errorCode(error) },
    })
    throw error
  }
}

async function readCachedResult(inputDir: string, normalizedAudioPath: string): Promise<TranscriptionResult | null> {
  const transcriptJsonPath = join(inputDir, 'transcript.json')
  const transcriptMarkdownPath = join(inputDir, 'transcript.md')
  const scriptPath = join(inputDir, 'script.json')
  try {
    const input = (await readScriptFile(scriptPath)).input
    const value = JSON.parse(await readFile(transcriptJsonPath, 'utf8')) as unknown
    if (!isRecord(value) || !Array.isArray(value.segments)) return null
    const segments = value.segments.map(parseTranscriptSegment)
    if (segments.some((segment) => segment === null)) return null
    await Promise.all([readFile(transcriptMarkdownPath), readFile(normalizedAudioPath)])
    return {
      input,
      transcriptJsonPath,
      transcriptMarkdownPath,
      scriptPath,
      normalizedAudioPath,
      segments: segments as TranscriptSegment[],
    }
  } catch {
    return null
  }
}

function parseTranscriptSegment(value: unknown): TranscriptSegment | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.startMs !== 'number' ||
    typeof value.endMs !== 'number' ||
    typeof value.text !== 'string' ||
    typeof value.audioPath !== 'string'
  )
    return null
  return { id: value.id, startMs: value.startMs, endMs: value.endMs, text: value.text, audioPath: value.audioPath }
}

function bindRealTimestamps(
  proposed: z.infer<typeof transcriptUnitSchema>[],
  segments: TranscriptSegment[],
): z.infer<typeof transcriptUnitSchema>[] {
  if (proposed.length !== segments.length)
    throw new SafeCliError('AI_OUTPUT_INVALID', '整理后的文稿分段数量不匹配。', true, 422)
  return proposed.map((unit, index) => {
    const source = segments[index]!
    if (unit.id !== source.id) throw new SafeCliError('AI_OUTPUT_INVALID', '整理后的文稿分段 ID 不匹配。', true, 422)
    return { ...unit, startMs: source.startMs, endMs: source.endMs }
  })
}

function renderTranscriptMarkdown(title: string, segments: TranscriptSegment[]): string {
  return `# ${title}\n\n${segments
    .map((segment) => `## ${segment.id} [${formatMs(segment.startMs)} - ${formatMs(segment.endMs)}]\n\n${segment.text}`)
    .join('\n\n')}\n`
}

function formatMs(value: number): string {
  const seconds = value / 1000
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`
}

function audioMimeType(path: string): SpeechAudioMimeType {
  return extname(path).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg'
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'ASR_FAILED'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
