import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'
import {
  TEXT_SCHEMA_VERSION,
  parseOpenAiCompatibleProfilePayload,
  type OpenAiCompatibleProfile,
} from './openai-compatible-payloads'

/** 形状与解析规则在 `openai-compatible-payloads.ts`；本模块只负责 Postgres 读写。 */
export interface OpenAiCompatibleProfileStore {
  find(workspaceId: string): Promise<OpenAiCompatibleProfile | null>
  save(workspaceId: string, profile: OpenAiCompatibleProfile): Promise<void>
}

const SETTINGS_KEY = 'ai.openai-compatible'

export class PostgresOpenAiCompatibleProfileStore implements OpenAiCompatibleProfileStore {
  constructor(private readonly database: () => Promise<PostgresDb>) {}

  async find(workspaceId: string): Promise<OpenAiCompatibleProfile | null> {
    const db = await this.database()
    const [row] = await db.select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(and(
        eq(workspaceSettings.workspaceId, workspaceId),
        eq(workspaceSettings.key, SETTINGS_KEY),
      ))
      .limit(1)
    return parseOpenAiCompatibleProfilePayload(row?.value)
  }

  async save(workspaceId: string, profile: OpenAiCompatibleProfile): Promise<void> {
    const db = await this.database()
    const value: VersionedPayload = {
      schemaVersion: TEXT_SCHEMA_VERSION,
      baseUrl: profile.baseUrl,
      textModel: profile.textModel,
      visionModel: profile.visionModel,
    }
    await db.insert(workspaceSettings).values({
      workspaceId,
      key: SETTINGS_KEY,
      value,
    }).onConflictDoUpdate({
      target: [workspaceSettings.workspaceId, workspaceSettings.key],
      set: { value, updatedAt: new Date() },
    })
  }
}
