import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'

/**
 * 自定义兼容文本端点的配置。
 *
 * `visionModel` 与 `textModel` 分开：另外三家供应商都有独立的文本/视觉模型字段，
 * 只有这里曾经用一个 `defaultModel` 兼两职，导致把分镜验收路由到本端点时，
 * 用户填的文本模型会被当成视觉模型直到运行期才失败。留空表示该端点不提供视觉
 * 能力，视觉路由会在保存时被拒绝。
 */
export interface OpenAiCompatibleProfile {
  baseUrl: string
  textModel: string
  visionModel: string | null
}

export interface OpenAiCompatibleProfileStore {
  find(workspaceId: string): Promise<OpenAiCompatibleProfile | null>
  save(workspaceId: string, profile: OpenAiCompatibleProfile): Promise<void>
}

const SETTINGS_KEY = 'ai.openai-compatible'
const SCHEMA_VERSION = 2

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
      schemaVersion: SCHEMA_VERSION,
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

/**
 * 解析已落库的 payload，兼容 v1。
 *
 * v1 只有一个 `defaultModel`，它当时同时服务文本与视觉。读成 `textModel` 是唯一
 * 诚实的映射：那个值只被 chat/completions 校验过，从未被证明能接受图像输入，
 * 所以 `visionModel` 保持 null 而不是拷贝一份。已有用户如果把分镜验收路由到本
 * 端点，会在下次保存路由时收到 422 并被要求显式填写视觉模型——这比继续拿一个
 * 未经视觉校验的模型去跑 QA 更可靠。
 *
 * 导出是为了让 v1 兼容读单独可测：这段逻辑一旦回归，已配置用户的文本链路会静默
 * 变成「未配置」。
 */
export function parseOpenAiCompatibleProfilePayload(
  value: unknown,
): OpenAiCompatibleProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const baseUrl = normalizeBaseUrl(record.baseUrl)
  if (!baseUrl) return null
  if (record.schemaVersion === 1) {
    const textModel = normalizeText(record.defaultModel)
    return textModel ? { baseUrl, textModel, visionModel: null } : null
  }
  if (record.schemaVersion !== SCHEMA_VERSION) return null
  const textModel = normalizeText(record.textModel)
  return textModel
    ? { baseUrl, textModel, visionModel: normalizeText(record.visionModel) }
    : null
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
