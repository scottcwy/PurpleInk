import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { SESSION_TTL_MS } from '@/lib/auth/session-cookie'
import {
  deleteSessionByTokenHash,
  findSessionOwner,
  insertSession,
  pruneExpiredAuthRows,
  touchSession,
  type SessionOwner,
} from './auth-repository'
import { LONGEST_THROTTLE_WINDOW_MS } from './throttle'

/** cookie 明文 32 字节随机；DB 只存 SHA-256。 */
const TOKEN_BYTES = 32
/** `lastSeenAt` 的写入节流：每请求一次 UPDATE 会把只读页面变成写路径。 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export type { SessionOwner }

/**
 * 会话 id 是高熵随机值，不需要 scrypt——scrypt 是为「低熵口令」设计的。
 * 这里 SHA-256 已足够：拿到 DB 也无法反推明文 cookie。
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export interface IssuedSession {
  token: string
  expiresAt: Date
}

export async function issueSession(input: {
  userId: string
  workspaceId: string
  userAgent?: string | null
  ip?: string | null
  now?: Date
}): Promise<IssuedSession> {
  const now = input.now ?? new Date()
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  await insertSession({
    tokenHash: hashSessionToken(token),
    userId: input.userId,
    workspaceId: input.workspaceId,
    expiresAt,
    userAgentHash: fingerprint(input.userAgent),
    ipHash: fingerprint(input.ip),
  })
  // 顺手清理过期行，避免三张认证表无界增长（§2.2）。失败不影响登录本身。
  await pruneExpiredAuthRows(now, LONGEST_THROTTLE_WINDOW_MS).catch((error: unknown) => {
    console.warn('[auth] 过期认证数据清理失败', error)
  })
  return { token, expiresAt }
}

/** 解析当前会话。同时按节流间隔推进 `lastSeenAt`，用于异常排查。 */
export async function resolveSession(
  token: string | null,
  now: Date = new Date(),
): Promise<SessionOwner | null> {
  if (!token) return null
  const owner = await findSessionOwner(hashSessionToken(token), now)
  if (!owner) return null
  void touchSessionIfStale(owner.sessionId, now)
  return owner
}

export async function revokeSession(token: string | null): Promise<void> {
  if (!token) return
  await deleteSessionByTokenHash(hashSessionToken(token))
}

const lastTouchedAt = new Map<string, number>()

async function touchSessionIfStale(sessionId: string, now: Date): Promise<void> {
  const previous = lastTouchedAt.get(sessionId) ?? 0
  if (now.getTime() - previous < TOUCH_INTERVAL_MS) return
  lastTouchedAt.set(sessionId, now.getTime())
  await touchSession(sessionId, now).catch((error: unknown) => {
    console.warn('[auth] 会话活跃时间写入失败', error)
  })
}

/**
 * UA 与 IP 只存哈希：足以发现「同一会话换了设备」，但不落 PII（§2.1）。
 * 这里不做校验拦截——移动网络下 IP 抖动很常见，硬校验会把正常用户踢下线。
 */
function fingerprint(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return createHash('sha256').update(trimmed, 'utf8').digest('hex')
}
