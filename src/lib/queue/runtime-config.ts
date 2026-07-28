import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'
import {
  DEFAULT_DIRECTOR_STAGE_CONCURRENCY,
  defaultRenderShotConcurrency,
} from './in-process-queue'
import { resolveLaneQuotas } from './lane-quota-env'
import type { LaneQuotas } from './types'

/**
 * ISSUE-011 队列并发配额的持久层与读取层。
 *
 * 数据落地 `workspace_settings(workspace_id, key)`，key = `SETTINGS_KEY`，
 * value jsonb 形状 `{ schemaVersion: 1, directorStage: number, renderShot: number }`。
 *
 * 真值优先级 **DB > env > 代码默认**，与 AGENTS.md §6、`features/ai/config.ts`
 * 的 `DB 路由 > env > 代码默认值` 口径完全一致，禁止在该链路上再引入第二套覆盖来源。
 *
 * 多用户后的语义澄清（PLAN-002 §5.3 / §9.2，已拍板）：配额是**进程级**配置，
 * 约束的是本机 CPU，与谁在用无关。`LOCAL_WORKSPACE_ID` 在这里只是进程级配置行的
 * 存放锚点，不是业务归属——不读请求上下文的 workspace，也不随登录用户变化。
 */

export type LaneQuotaSource = 'settings' | 'env' | 'default'

export interface LaneQuotaFieldView {
  value: number
  source: LaneQuotaSource
}

export interface LaneQuotaView {
  directorStage: LaneQuotaFieldView
  renderShot: LaneQuotaFieldView
}

interface StoredLaneQuotas {
  schemaVersion: number
  directorStage: number
  renderShot: number
}

const SETTINGS_KEY = 'queue.lane_quotas'

/**
 * 读 DB 中已存的 lane quotas。未命中、版本不符或字段非法时返回 null；
 * 调用方需自行回落 env / 默认——本函数只负责 DB 真值投影，不擅自默认。
 */
async function readStoredLaneQuotas(): Promise<StoredLaneQuotas | null> {
  const database = await getDb()
  const [row] = await database
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(
      and(
        eq(workspaceSettings.workspaceId, LOCAL_WORKSPACE_ID),
        eq(workspaceSettings.key, SETTINGS_KEY),
      ),
    )
    .limit(1)
  if (!row) return null
  const v = row.value as Record<string, unknown>
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  if (v.schemaVersion !== 1) return null
  const { directorStage, renderShot } = v
  if (
    typeof directorStage !== 'number' ||
    typeof renderShot !== 'number' ||
    !Number.isInteger(directorStage) ||
    !Number.isInteger(renderShot) ||
    directorStage < 1 ||
    renderShot < 1
  ) {
    return null
  }
  return { schemaVersion: 1, directorStage, renderShot }
}

interface ResolvedLane {
  kind: 'director-stage' | 'render-shot'
  envKey: string
  defaultValue: number
}

const DIRECTOR_LANE: ResolvedLane = {
  kind: 'director-stage',
  envKey: 'CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY',
  defaultValue: DEFAULT_DIRECTOR_STAGE_CONCURRENCY,
}
const RENDER_LANE: ResolvedLane = {
  kind: 'render-shot',
  envKey: 'CVC_QUEUE_RENDER_SHOT_CONCURRENCY',
  defaultValue: defaultRenderShotConcurrency(),
}

function resolveLane(
  stored: StoredLaneQuotas | null,
  env: Record<string, string | undefined>,
  lane: ResolvedLane,
  storedValue: number | undefined,
): { value: number; source: LaneQuotaSource } {
  if (stored && storedValue !== undefined) {
    return { value: storedValue, source: 'settings' }
  }
  const raw = env[lane.envKey]
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed >= 1) {
      return { value: parsed, source: 'env' }
    }
  }
  return { value: lane.defaultValue, source: 'default' }
}

/**
 * 返回两个 lane 的当前真值与 source；用于设置页只读视图。
 * 非法 env 不会在本函数中抛错——`init.ts` 的 `resolveLaneQuotas`
 * 会在启动期对 env 做严格校验；此处解析失败即视为 env 未设置、回落默认。
 */
export async function describeLaneQuotas(
  env: Record<string, string | undefined> = process.env,
): Promise<LaneQuotaView> {
  const stored = await readStoredLaneQuotas()
  return {
    directorStage: resolveLane(stored, env, DIRECTOR_LANE, stored?.directorStage),
    renderShot: resolveLane(stored, env, RENDER_LANE, stored?.renderShot),
  }
}

/**
 * 启动期加载并合并 DB / env / 默认，返回 `in-process-queue.ts` `start(lanes)` 入参。
 * 仅返回**已被覆盖的** lane，未覆盖 lane 由 queue 内部走 `defaultLaneQuotas()`。
 * 这保证 DB 未配置时，env override 与启动前的行为完全一致，避免静默语义漂移。
 */
export async function loadLaneQuotasForStart(
  env: Record<string, string | undefined> = process.env,
): Promise<LaneQuotas> {
  const stored = await readStoredLaneQuotas()
  const envOverrides = resolveLaneQuotas(env)
  const overrides: LaneQuotas = {}
  if (stored?.directorStage) {
    overrides['director-stage'] = stored.directorStage
  } else if (envOverrides['director-stage']) {
    overrides['director-stage'] = envOverrides['director-stage']
  }
  if (stored?.renderShot) {
    overrides['render-shot'] = stored.renderShot
  } else if (envOverrides['render-shot']) {
    overrides['render-shot'] = envOverrides['render-shot']
  }
  return overrides
}

/**
 * 写入 lane quotas 到 `workspace_settings`。本函数只做持久化；
 * 范围 / 上限校验由调用方（API route）做，违反的请求在到达这里前就被 400 拒绝。
 * 因此本入口的契约：调用方需先把 `{ directorStage, renderShot }` 整理成 1..上限 整数。
 */
export async function saveLaneQuotas(
  input: { directorStage: number; renderShot: number },
): Promise<void> {
  if (
    !Number.isInteger(input.directorStage) ||
    input.directorStage < 1 ||
    !Number.isInteger(input.renderShot) ||
    input.renderShot < 1
  ) {
    throw new Error(
      `saveLaneQuotas called with invalid input: ${JSON.stringify(input)}`,
    )
  }
  const database = await getDb()
  const value: VersionedPayload = {
    schemaVersion: 1,
    directorStage: input.directorStage,
    renderShot: input.renderShot,
  }
  await database
    .insert(workspaceSettings)
    .values({
      workspaceId: LOCAL_WORKSPACE_ID,
      key: SETTINGS_KEY,
      value,
    })
    .onConflictDoUpdate({
      target: [workspaceSettings.workspaceId, workspaceSettings.key],
      set: { value, updatedAt: new Date() },
    })
}
