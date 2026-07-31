import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'
import {
  AUDIO_SCHEMA_VERSION,
  parseAsrProfilePayload,
  parseTtsProfilePayload,
  type OpenAiCompatibleAsrProfile,
  type OpenAiCompatibleTtsProfile,
} from './openai-compatible-payloads'

/**
 * 自定义兼容音频端点的 Postgres 读写。
 *
 * 与文本端点分成独立模块而不是塞进同一个 store：两者 payload 形状不同（音频侧有
 * 音色、容器格式与时间戳能力），且文本 profile 的 key 必须保持原样不动——它的解析
 * 一旦回归，已配置用户的整条文本链路会静默变成「未配置」。
 * 形状与解析规则在 `openai-compatible-payloads.ts`。
 */
export interface OpenAiCompatibleAudioProfileStore {
  findTts(workspaceId: string): Promise<OpenAiCompatibleTtsProfile | null>
  saveTts(workspaceId: string, profile: OpenAiCompatibleTtsProfile): Promise<void>
  findAsr(workspaceId: string): Promise<OpenAiCompatibleAsrProfile | null>
  saveAsr(workspaceId: string, profile: OpenAiCompatibleAsrProfile): Promise<void>
}

const TTS_KEY = 'ai.openai-compatible.tts'
const ASR_KEY = 'ai.openai-compatible.asr'

export class PostgresOpenAiCompatibleAudioProfileStore
implements OpenAiCompatibleAudioProfileStore {
  constructor(private readonly database: () => Promise<PostgresDb>) {}

  async findTts(workspaceId: string): Promise<OpenAiCompatibleTtsProfile | null> {
    return parseTtsProfilePayload(await this.read(workspaceId, TTS_KEY))
  }

  async saveTts(
    workspaceId: string,
    profile: OpenAiCompatibleTtsProfile,
  ): Promise<void> {
    await this.write(workspaceId, TTS_KEY, {
      schemaVersion: AUDIO_SCHEMA_VERSION,
      baseUrl: profile.baseUrl,
      model: profile.model,
      voice: profile.voice,
      audioFormat: profile.audioFormat,
    })
  }

  async findAsr(workspaceId: string): Promise<OpenAiCompatibleAsrProfile | null> {
    return parseAsrProfilePayload(await this.read(workspaceId, ASR_KEY))
  }

  async saveAsr(
    workspaceId: string,
    profile: OpenAiCompatibleAsrProfile,
  ): Promise<void> {
    await this.write(workspaceId, ASR_KEY, {
      schemaVersion: AUDIO_SCHEMA_VERSION,
      baseUrl: profile.baseUrl,
      model: profile.model,
      timestampMode: profile.timestampMode,
      verification: profile.verification,
    })
  }

  private async read(workspaceId: string, key: string): Promise<unknown> {
    const db = await this.database()
    const [row] = await db.select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(and(
        eq(workspaceSettings.workspaceId, workspaceId),
        eq(workspaceSettings.key, key),
      ))
      .limit(1)
    return row?.value
  }

  private async write(
    workspaceId: string,
    key: string,
    value: VersionedPayload,
  ): Promise<void> {
    const db = await this.database()
    await db.insert(workspaceSettings).values({ workspaceId, key, value })
      .onConflictDoUpdate({
        target: [workspaceSettings.workspaceId, workspaceSettings.key],
        set: { value, updatedAt: new Date() },
      })
  }
}
