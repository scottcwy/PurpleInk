import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

import { z } from 'zod'

import { SafeCliError } from '../safe-error'
import { assertSupportedAudioSample, type SpeechAudioMimeType } from '../speech/mimo-client'

const voiceIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const storedVoiceSchema = z
  .object({
    id: z.string().regex(voiceIdPattern),
    mimeType: z.enum(['audio/wav', 'audio/mpeg']),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    relativePath: z.string().regex(/^samples\/[a-z0-9-]+\.(?:wav|mp3)$/u),
  })
  .strict()

const voiceIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeVoice: z.string(),
    voices: z.array(storedVoiceSchema),
  })
  .strict()

type VoiceIndex = z.infer<typeof voiceIndexSchema>
type StoredVoice = z.infer<typeof storedVoiceSchema>

export interface VoiceStorePaths {
  rootDir: string
  indexPath: string
  samplesDir: string
}

export interface LocalVoice {
  id: string
  mimeType: 'audio/wav' | 'audio/mpeg'
  sizeBytes: number
  sha256: string
  path: string
}

export interface VoiceList {
  activeVoice: string
  voices: LocalVoice[]
}

export class VoiceStore {
  constructor(readonly paths: VoiceStorePaths) {}

  async import(sourcePath: string, name: string): Promise<LocalVoice> {
    const id = validateVoiceId(name)
    const format = sampleFormat(sourcePath)
    const bytes = await readFile(resolve(sourcePath))
    assertSupportedAudioSample(bytes, format.mimeType)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const index = await this.readIndex()
    const existing = index.voices.find((voice) => voice.id === id)
    if (existing) {
      if (existing.sha256 !== sha256) {
        throw new SafeCliError('VOICE_NAME_CONFLICT', '同名 voice 已存在且样音内容不同。', false, 409)
      }
      return this.project(existing)
    }

    const relativePath = `samples/${id}.${format.extension}`
    const stored: StoredVoice = {
      id,
      mimeType: format.mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      relativePath,
    }
    const samplePath = join(this.paths.rootDir, ...relativePath.split('/'))
    await this.atomicWrite(samplePath, bytes)
    try {
      await this.writeIndex({ ...index, voices: [...index.voices, stored].sort((a, b) => a.id.localeCompare(b.id)) })
    } catch (error) {
      await rm(samplePath, { force: true }).catch(() => undefined)
      throw error
    }
    return this.project(stored)
  }

  async use(name: string): Promise<{ activeVoice: string }> {
    const index = await this.readIndex()
    if (name !== 'mimo_default') {
      const id = validateVoiceId(name)
      if (!index.voices.some((voice) => voice.id === id)) {
        throw new SafeCliError('VOICE_NOT_FOUND', '没有找到指定的本地 voice。', false, 404)
      }
    }
    await this.writeIndex({ ...index, activeVoice: name })
    return { activeVoice: name }
  }

  async list(): Promise<VoiceList> {
    const index = await this.readIndex()
    return { activeVoice: index.activeVoice, voices: index.voices.map((voice) => this.project(voice)) }
  }

  private async readIndex(): Promise<VoiceIndex> {
    if (!(await exists(this.paths.indexPath))) return { schemaVersion: 1, activeVoice: 'mimo_default', voices: [] }
    try {
      return voiceIndexSchema.parse(JSON.parse(await readFile(this.paths.indexPath, 'utf8')) as unknown)
    } catch {
      throw new SafeCliError('VOICE_INDEX_INVALID', '本地 voice 索引无效。', false, 422)
    }
  }

  private async writeIndex(index: VoiceIndex): Promise<void> {
    const parsed = voiceIndexSchema.parse(index)
    await this.atomicWrite(this.paths.indexPath, Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8'))
  }

  private async atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp-${randomUUID()}`
    try {
      await writeFile(temporaryPath, bytes)
      await rename(temporaryPath, path)
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new SafeCliError('VOICE_WRITE_FAILED', '无法原子写入本地 voice。', false, 500)
    }
  }

  private project(voice: StoredVoice): LocalVoice {
    return {
      id: voice.id,
      mimeType: voice.mimeType,
      sizeBytes: voice.sizeBytes,
      sha256: voice.sha256,
      path: join(this.paths.rootDir, ...voice.relativePath.split('/')),
    }
  }
}

export function resolveVoiceStorePaths(env: NodeJS.ProcessEnv = process.env, localAppData?: string): VoiceStorePaths {
  const base = localAppData?.trim() || env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
  const rootDir = resolve(base, 'PurpleInk', 'voices')
  return { rootDir, indexPath: join(rootDir, 'index.json'), samplesDir: join(rootDir, 'samples') }
}

function validateVoiceId(value: string): string {
  const id = value.trim()
  if (!voiceIdPattern.test(id)) {
    throw new SafeCliError('VOICE_NAME_INVALID', 'voice name 只允许小写字母、数字和连字符。', false, 400)
  }
  return id
}

function sampleFormat(path: string): {
  extension: 'wav' | 'mp3'
  mimeType: Extract<SpeechAudioMimeType, 'audio/wav' | 'audio/mpeg'>
} {
  const extension = extname(path).toLowerCase()
  if (extension === '.wav') return { extension: 'wav', mimeType: 'audio/wav' }
  if (extension === '.mp3') return { extension: 'mp3', mimeType: 'audio/mpeg' }
  throw new SafeCliError('VOICE_FORMAT_UNSUPPORTED', '样音只支持 WAV 或 MP3。', false, 400)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
