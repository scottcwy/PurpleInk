import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'
import { AI_PROVIDER_IDS, type AiProviderId } from './provider-registry'

/**
 * 备选 provider 的显式配置（模式 H 阶段 4 降级链）。
 *
 * 保守设计：**默认无备选**——没有这行配置时，主 provider 熔断只会得到
 * 「AI 服务暂时不可用」的可重试失败，绝不擅自替用户换模型。`null` 表示
 * 显式清空备选，与「从未配置」同义。
 */
export interface FallbackProviderStore {
  find(workspaceId: string): Promise<AiProviderId | null>
  save(workspaceId: string, provider: AiProviderId | null): Promise<void>
}

const SETTINGS_KEY = 'ai.fallback-provider'
const SCHEMA_VERSION = 1

/** 历史行里出现未知 provider（如已下线的 id）时保守返回 null，而不是让路由炸掉。 */
const payloadSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  provider: z.enum(AI_PROVIDER_IDS),
})

function parseFallbackPayload(value: unknown): AiProviderId | null {
  const parsed = payloadSchema.safeParse(value)
  return parsed.success ? parsed.data.provider : null
}

export class PostgresFallbackProviderStore implements FallbackProviderStore {
  constructor(private readonly database: () => Promise<PostgresDb>) {}

  async find(workspaceId: string): Promise<AiProviderId | null> {
    const db = await this.database()
    const [row] = await db.select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(and(
        eq(workspaceSettings.workspaceId, workspaceId),
        eq(workspaceSettings.key, SETTINGS_KEY),
      ))
      .limit(1)
    return row ? parseFallbackPayload(row.value) : null
  }

  async save(workspaceId: string, provider: AiProviderId | null): Promise<void> {
    const db = await this.database()
    if (provider === null) {
      // 清空即删行：留一行 `provider: null` 的记录没有额外语义，只会让
      // 「是否配置了备选」出现两种真值表示。
      await db.delete(workspaceSettings).where(and(
        eq(workspaceSettings.workspaceId, workspaceId),
        eq(workspaceSettings.key, SETTINGS_KEY),
      ))
      return
    }
    const value: VersionedPayload = {
      schemaVersion: SCHEMA_VERSION,
      provider,
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
