import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'

export interface OpenAiCompatibleProfile {
  baseUrl: string
  defaultModel: string
}

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
    return parseProfile(row?.value)
  }

  async save(workspaceId: string, profile: OpenAiCompatibleProfile): Promise<void> {
    const db = await this.database()
    const value: VersionedPayload = {
      schemaVersion: 1,
      baseUrl: profile.baseUrl,
      defaultModel: profile.defaultModel,
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

function parseProfile(value: unknown): OpenAiCompatibleProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) return null
  const baseUrl = normalizeBaseUrl(record.baseUrl)
  const defaultModel = normalizeText(record.defaultModel)
  return baseUrl && defaultModel ? { baseUrl, defaultModel } : null
}

export function normalizeBaseUrl(value: unknown): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return normalized.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
