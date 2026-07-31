import 'server-only'
import { randomBytes } from 'node:crypto'
import {
  createUserWithWorkspace,
  findPrimaryWorkspaceId,
  findUserByEmail,
  updatePasswordAndRevokeSessions,
} from './auth-repository'
import { authFailure, type AuthFailure } from './errors'
import { hashPassword, verifyPassword } from './password'
import { issueSession, type IssuedSession } from './session'
import { clearThrottleSlot, consumeThrottleSlot } from './throttle'
import { consumeVerificationCodeFor } from './verification-service'
import type { LoginInput, ResetPasswordInput, SignupInput } from './schemas'

export interface RequestFingerprint {
  ip: string
  userAgent: string | null
}

/**
 * 注册（PLAN-002 §3.3）。
 *
 * 验证码先消费再建账号：反过来会在「码无效」时留下已创建但未验证的用户行，
 * 而 `users.email` 上有唯一索引，那行会永久占住这个邮箱。
 *
 * 邮箱已被占用时也回 `code-invalid`：能走到这一步说明对方已经拿到该邮箱的
 * 有效验证码（即掌握该邮箱），但仍不该由本端点确认「此邮箱已注册」，
 * 而应引导去登录。
 */
export async function registerAccount(
  input: SignupInput & { fingerprint: RequestFingerprint; now?: Date },
): Promise<{ ok: true; session: IssuedSession } | AuthFailure> {
  const now = input.now ?? new Date()
  const consumed = await consumeVerificationCodeFor({
    email: input.email,
    purpose: 'signup',
    code: input.code,
    now,
  })
  if (!consumed.ok) return consumed

  if (await findUserByEmail(input.email)) return authFailure('code-invalid')

  const { userId, workspaceId } = await createUserWithWorkspace({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    workspaceName: input.workspaceName,
    emailVerifiedAt: now,
  })
  return {
    ok: true,
    session: await issueSession({
      userId,
      workspaceId,
      ip: input.fingerprint.ip,
      userAgent: input.fingerprint.userAgent,
      now,
    }),
  }
}

/**
 * 登录。
 *
 * 「账号不存在」与「口令错误」走同一条返回路径，并且**两种情况都执行一次
 * 口令哈希校验**——否则不存在的账号会明显更快返回，时间差本身就是枚举信号。
 */
export async function authenticate(
  input: LoginInput & { fingerprint: RequestFingerprint; now?: Date },
): Promise<{ ok: true; session: IssuedSession } | AuthFailure> {
  const now = input.now ?? new Date()
  for (const [rule, dimension, value] of [
    ['loginFailureByEmail', 'email', input.email],
    ['loginFailureByIp', 'ip', input.fingerprint.ip],
  ] as const) {
    const decision = await consumeThrottleSlot({ rule, dimension, value, now })
    if (!decision.allowed) {
      return authFailure('rate-limited', { retryAfterMs: decision.retryAfterMs })
    }
  }

  const user = await findUserByEmail(input.email)
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await decoyPasswordHash()),
  )
  if (!user || !passwordMatches || user.status !== 'active' || !user.emailVerifiedAt) {
    return authFailure('invalid-credentials')
  }

  const workspaceId = await findPrimaryWorkspaceId(user.id)
  if (!workspaceId) {
    // 数据不一致（有账号无 workspace）。不对外解释，只留服务端诊断。
    console.error('[auth] 用户缺少 workspace 成员关系，登录被拒绝', { userId: user.id })
    return authFailure('invalid-credentials')
  }

  await clearThrottleSlot({ rule: 'loginFailureByEmail', dimension: 'email', value: input.email })
  return {
    ok: true,
    session: await issueSession({
      userId: user.id,
      workspaceId,
      ip: input.fingerprint.ip,
      userAgent: input.fingerprint.userAgent,
      now,
    }),
  }
}

/**
 * 重置口令。成功后**失效该用户全部会话**（含发起本次重置的那个），
 * 因此调用方需要重新签发会话。
 */
export async function resetPassword(
  input: ResetPasswordInput & { fingerprint: RequestFingerprint; now?: Date },
): Promise<{ ok: true; session: IssuedSession } | AuthFailure> {
  const now = input.now ?? new Date()
  const consumed = await consumeVerificationCodeFor({
    email: input.email,
    purpose: 'password_reset',
    code: input.code,
    now,
  })
  if (!consumed.ok) return consumed

  const user = await findUserByEmail(input.email)
  if (!user || user.status !== 'active') return authFailure('code-invalid')
  const workspaceId = await findPrimaryWorkspaceId(user.id)
  if (!workspaceId) return authFailure('code-invalid')

  await updatePasswordAndRevokeSessions({
    userId: user.id,
    passwordHash: await hashPassword(input.password),
  })
  // 旧会话已全部作废，这里重新签发一条，用户不必再手动登录一次。
  return {
    ok: true,
    session: await issueSession({
      userId: user.id,
      workspaceId,
      ip: input.fingerprint.ip,
      userAgent: input.fingerprint.userAgent,
      now,
    }),
  }
}

/**
 * 邮箱不存在时的占位哈希，让登录校验耗时与真实账号一致——否则「不存在的账号
 * 明显更快返回」本身就是枚举信号。
 *
 * 不写死一个常量串，而是进程启动后按需从随机原文派生一次：随机原文不落任何
 * 地方，因此这个哈希永远不可能被匹配上。
 */
let decoyHash: Promise<string> | undefined

function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('base64url'))
  return decoyHash
}
