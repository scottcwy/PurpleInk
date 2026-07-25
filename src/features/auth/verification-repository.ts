import 'server-only'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { emailVerificationCodes } from '@/lib/db/schema/index'
import type { VerificationCodeRecord, VerificationPurpose } from './verification-code'

export interface StoredVerificationCode extends VerificationCodeRecord {
  id: string
}

export async function insertVerificationCode(input: {
  email: string
  purpose: VerificationPurpose
  codeHash: string
  expiresAt: Date
}): Promise<void> {
  const database = await getDb()
  await database.insert(emailVerificationCodes).values({
    email: input.email,
    purpose: input.purpose,
    codeHash: input.codeHash,
    expiresAt: input.expiresAt,
  })
}

/**
 * 取该邮箱 + 用途下最近一条未消费的码。
 *
 * 只取最新一条是有意的：重发验证码后旧码应当失效。旧码不会被删除（保留
 * `attemptCount` 供排查），但不会被这里选中，因此无法再通过校验。
 */
export async function findLatestUnconsumedCode(
  email: string,
  purpose: VerificationPurpose,
): Promise<StoredVerificationCode | null> {
  const database = await getDb()
  const [row] = await database
    .select({
      id: emailVerificationCodes.id,
      codeHash: emailVerificationCodes.codeHash,
      expiresAt: emailVerificationCodes.expiresAt,
      consumedAt: emailVerificationCodes.consumedAt,
      attemptCount: emailVerificationCodes.attemptCount,
    })
    .from(emailVerificationCodes)
    .where(
      and(
        sql`lower(${emailVerificationCodes.email}) = ${email.trim().toLowerCase()}`,
        eq(emailVerificationCodes.purpose, purpose),
        isNull(emailVerificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1)
  return row ?? null
}

/** 记一次失败尝试。计数在服务端，客户端无法重置。 */
export async function incrementVerificationAttempt(id: string): Promise<void> {
  const database = await getDb()
  await database
    .update(emailVerificationCodes)
    .set({ attemptCount: sql`${emailVerificationCodes.attemptCount} + 1` })
    .where(eq(emailVerificationCodes.id, id))
}

/**
 * 一次性消费。带 `consumed_at is null` 条件并按受影响行数返回，
 * 让并发双提交只有一方成功（不靠应用层加锁）。
 */
export async function consumeVerificationCode(id: string, now: Date): Promise<boolean> {
  const database = await getDb()
  const updated = await database
    .update(emailVerificationCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailVerificationCodes.id, id), isNull(emailVerificationCodes.consumedAt)))
    .returning({ id: emailVerificationCodes.id })
  return updated.length === 1
}
