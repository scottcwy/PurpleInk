import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ZodError } from 'zod'

import {
  InputContractError,
  SCRIPT_VIDEO_SCHEMA_VERSION,
  type ScriptVideoInput,
  scriptVideoInputSchema,
} from './contracts'

export interface ReadScriptResult {
  input: ScriptVideoInput
  sourceBytes: Buffer
  inputHash: string
  sourcePath: string
}

export function parseScriptValue(value: unknown): ScriptVideoInput {
  try {
    return scriptVideoInputSchema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')
      throw new InputContractError(`文稿输入无效: ${detail}`, { cause: error })
    }
    throw error
  }
}

export function parseScriptText(text: string, fileName = 'script.md'): ScriptVideoInput {
  if (extname(fileName).toLowerCase() === '.json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch (error) {
      throw new InputContractError('JSON 文稿无法解析', { cause: error })
    }
    return parseScriptValue(parsed)
  }

  return parseMarkdown(text, fileName)
}

export async function readScriptFile(sourcePath: string): Promise<ReadScriptResult> {
  const sourceBytes = await readFile(sourcePath)
  const input = parseScriptText(sourceBytes.toString('utf8'), sourcePath)
  return {
    input,
    sourceBytes,
    inputHash: hashSourceBytes(sourceBytes),
    sourcePath,
  }
}

export function hashSourceBytes(sourceBytes: Uint8Array): string {
  return createHash('sha256').update(sourceBytes).digest('hex')
}

function parseMarkdown(text: string, fileName: string): ScriptVideoInput {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const titleLine = lines.find((line) => /^#\s+\S/u.test(line.trim()))
  const title = titleLine?.trim().replace(/^#\s+/u, '').trim() || titleFromFileName(fileName)

  const units: Array<{ id: string; text: string; visualIntent: string }> = []
  let current: string[] | null = null

  const flush = (): void => {
    if (!current) return
    const body = current.join('\n').trim()
    if (body) {
      const id = `U${String(units.length + 1).padStart(3, '0')}`
      units.push({ id, text: body, visualIntent: 'show' })
    }
    current = null
  }

  for (const line of lines) {
    if (/^#{2,}\s+\S/u.test(line.trim())) {
      flush()
      current = []
      continue
    }
    if (/^#\s+\S/u.test(line.trim())) continue
    if (current) current.push(line)
  }
  flush()

  if (units.length === 0) {
    const fallbackBody = lines
      .filter((line) => !/^#/.test(line.trim()))
      .join('\n')
      .trim()
    if (fallbackBody) {
      units.push({ id: 'U001', text: fallbackBody, visualIntent: 'show' })
    }
  }

  return parseScriptValue({
    schemaVersion: SCRIPT_VIDEO_SCHEMA_VERSION,
    title,
    language: 'zh-CN',
    durationSec: 30,
    visualStyle: 'editorial technical',
    narration: 'auto',
    units,
  })
}

function titleFromFileName(fileName: string): string {
  const value = basename(fileName, extname(fileName)).trim()
  return value || 'Untitled script video'
}
