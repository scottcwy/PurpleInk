import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { OpenAiCompatibleConfig } from './ai/openai-compatible'
import type { SecretProtector } from './dpapi'
import { SafeCliError } from './safe-error'

export interface ConcurrencyConfig {
  run: number
  text: number
  browser: number
  tts: number
  asr: number
  render: number
}

export const concurrencyDefaults: Readonly<ConcurrencyConfig> = {
  run: 2,
  text: 6,
  browser: 3,
  tts: 3,
  asr: 2,
  render: 1,
} as const

const concurrencySchema = z
  .object({
    run: z.number().int().min(1).max(32),
    text: z.number().int().min(1).max(32),
    browser: z.number().int().min(1).max(32),
    tts: z.number().int().min(1).max(32),
    asr: z.number().int().min(1).max(32),
    render: z.number().int().min(1).max(32),
  })
  .strict()

const textProfileSchema = z
  .object({
    baseUrl: z.string().url(),
    model: z.string().trim().min(1).max(200),
    secretRef: z.string().regex(/^text-[a-zA-Z0-9._-]+\.dpapi$/u),
  })
  .strict()

const speechProfileSchema = z
  .object({
    baseUrl: z.string().url(),
    ttsModel: z.string().trim().min(1).max(200),
    asrModel: z.string().trim().min(1).max(200),
    secretRef: z.string().regex(/^speech-[a-zA-Z0-9._-]+\.dpapi$/u),
  })
  .strict()

export const localConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.string().datetime(),
    text: textProfileSchema.optional(),
    speech: speechProfileSchema.optional(),
    concurrency: concurrencySchema,
  })
  .strict()

export type LocalConfig = z.infer<typeof localConfigSchema>

export interface LocalConfigPaths {
  rootDir: string
  configPath: string
  secretsDir: string
}

export interface LocalConfigIo {
  read(path: string): Promise<Uint8Array>
  write(path: string, value: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(directory: string): Promise<string[]>
}

export interface LocalConfigStoreOptions {
  io?: LocalConfigIo
  now?: () => Date
}

export interface LocalConfigSummary {
  text: { configured: boolean; baseUrl: string | null; model: string | null }
  speech: {
    configured: boolean
    baseUrl: string | null
    ttsModel: string | null
    asrModel: string | null
  }
  concurrency: ConcurrencyConfig
}

export interface SecretCleanupStatus {
  status: 'clean' | 'pending'
  pendingCount: number
}

export interface SaveTextProfileResult {
  secretCleanup: SecretCleanupStatus
}

export class LocalConfigStore {
  private readonly io: LocalConfigIo
  private readonly now: () => Date

  constructor(
    readonly paths: LocalConfigPaths,
    private readonly protector: SecretProtector,
    options: LocalConfigStoreOptions = {},
  ) {
    this.io = options.io ?? nodeConfigIo
    this.now = options.now ?? (() => new Date())
  }

  async read(): Promise<LocalConfig | null> {
    if (!(await this.io.exists(this.paths.configPath))) return null
    try {
      const value = JSON.parse(Buffer.from(await this.io.read(this.paths.configPath)).toString('utf8')) as unknown
      return localConfigSchema.parse(value)
    } catch {
      throw new SafeCliError('CONFIG_FILE_INVALID', '本地配置文件无效。', false, 422)
    }
  }

  async summary(): Promise<LocalConfigSummary> {
    const config = await this.read()
    const textConfigured = Boolean(
      config?.text && (await this.io.exists(join(this.paths.secretsDir, config.text.secretRef))),
    )
    const speechConfigured = Boolean(
      config?.speech && (await this.io.exists(join(this.paths.secretsDir, config.speech.secretRef))),
    )
    return {
      text: {
        configured: textConfigured,
        baseUrl: config?.text?.baseUrl ?? null,
        model: config?.text?.model ?? null,
      },
      speech: {
        configured: speechConfigured,
        baseUrl: config?.speech?.baseUrl ?? null,
        ttsModel: config?.speech?.ttsModel ?? null,
        asrModel: config?.speech?.asrModel ?? null,
      },
      concurrency: config?.concurrency ?? concurrencyDefaults,
    }
  }

  async saveTextProfile(profile: { baseUrl: string; model: string; apiKey: string }): Promise<SaveTextProfileResult> {
    const current = await this.read()
    const now = this.now()
    const secretRef = `text-${now.toISOString().replace(/[^0-9A-Z]/giu, '')}-${randomUUID()}.dpapi`
    const secretPath = join(this.paths.secretsDir, secretRef)
    const next = localConfigSchema.parse({
      schemaVersion: 1,
      updatedAt: now.toISOString(),
      text: { baseUrl: profile.baseUrl, model: profile.model, secretRef },
      ...(current?.speech ? { speech: current.speech } : {}),
      concurrency: current?.concurrency ?? concurrencyDefaults,
    })
    const encrypted = await this.protector.protect(profile.apiKey)
    await this.atomicWrite(secretPath, encrypted)
    try {
      await this.atomicWrite(this.paths.configPath, Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'))
    } catch (error) {
      await this.io.remove(secretPath).catch(() => undefined)
      throw error
    }
    return { secretCleanup: await this.reclaimUnreferencedSecrets(next) }
  }

  async loadTextProvider(): Promise<OpenAiCompatibleConfig> {
    const config = await this.read()
    if (!config?.text) throw new SafeCliError('CONFIG_NOT_CONFIGURED', '文本模型尚未配置。', false, 422)
    const secretPath = join(this.paths.secretsDir, config.text.secretRef)
    if (!(await this.io.exists(secretPath))) {
      throw new SafeCliError('CONFIG_NOT_CONFIGURED', '文本模型密钥尚未配置。', false, 422)
    }
    const apiKey = await this.protector.unprotect(await this.io.read(secretPath))
    if (!apiKey.trim()) throw new SafeCliError('CONFIG_NOT_CONFIGURED', '文本模型密钥尚未配置。', false, 422)
    return { baseUrl: config.text.baseUrl, apiKey, textModel: config.text.model }
  }

  private async atomicWrite(path: string, value: Uint8Array): Promise<void> {
    await this.io.mkdir(dirname(path))
    const temporaryPath = `${path}.tmp-${randomUUID()}`
    try {
      await this.io.write(temporaryPath, value)
      await this.io.rename(temporaryPath, path)
    } catch (error) {
      await this.io.remove(temporaryPath).catch(() => undefined)
      throw new SafeCliError('CONFIG_WRITE_FAILED', '无法原子写入本地配置。', false, 500)
    }
  }

  private async reclaimUnreferencedSecrets(config: LocalConfig): Promise<SecretCleanupStatus> {
    const referenced = new Set([
      ...(config.text ? [config.text.secretRef] : []),
      ...(config.speech ? [config.speech.secretRef] : []),
    ])
    const candidates = (await this.io.list(this.paths.secretsDir)).filter(
      (name) => /^(?:text|speech)-[a-zA-Z0-9._-]+\.dpapi$/u.test(name) && !referenced.has(name),
    )
    let pendingCount = 0
    for (const candidate of candidates) {
      try {
        await this.io.remove(join(this.paths.secretsDir, candidate))
      } catch {
        pendingCount += 1
      }
    }
    return { status: pendingCount === 0 ? 'clean' : 'pending', pendingCount }
  }
}

export function resolveLocalConfigPaths(env: NodeJS.ProcessEnv = process.env, localAppData?: string): LocalConfigPaths {
  const base = localAppData?.trim() || env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
  const rootDir = resolve(base, 'PurpleInk')
  return { rootDir, configPath: join(rootDir, 'config.json'), secretsDir: join(rootDir, 'secrets') }
}

export function normalizeProviderBaseUrl(value: string): string {
  const original = value.trim()
  let parsed: URL
  try {
    parsed = new URL(original)
  } catch {
    throw new SafeCliError('CONFIG_URL_INVALID', '文本模型 URL 无效。', false, 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeCliError('CONFIG_URL_INVALID', '文本模型 URL 协议无效。', false, 400)
  }
  if (parsed.hash) {
    throw new SafeCliError('CONFIG_URL_FRAGMENT_FORBIDDEN', '文本模型 URL 不能包含 fragment。', false, 400)
  }
  const designatedRoot =
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === 'api2.agentsnav.com' &&
    parsed.port === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    parsed.username === '' &&
    parsed.password === ''
  return designatedRoot ? 'https://api2.agentsnav.com/v1' : original
}

const nodeConfigIo: LocalConfigIo = {
  read: (path) => readFile(path),
  write: (path, value) => writeFile(path, value),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  rename,
  remove: async (path) => {
    await rm(path, { force: true })
  },
  exists: async (path) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  },
  list: async (directory) => {
    try {
      return await readdir(directory)
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return []
      throw error
    }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
