import 'server-only'
import { authFailure, type AuthFailure } from './errors'
import { findUserByEmail } from './auth-repository'
import { passesHumanCheck } from './human-check-service'
import { shouldHideFailureFromCaller } from './mail-failure'
import { sendVerificationCodeEmail } from './mailer'
import { authSigningKey } from './signing-key'
import { consumeThrottleSlot } from './throttle'
import {
  checkVerificationCode,
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeExpiresAt,
  type VerificationPurpose,
} from './verification-code'
import {
  consumeVerificationCode,
  findLatestUnconsumedCode,
  incrementVerificationAttempt,
  insertVerificationCode,
} from './verification-repository'

export interface RequestCodeInput {
  email: string
  purpose: VerificationPurpose
  humanCheckToken: string
  humanCheckAnswer: string
  contactReference?: string
  ip: string
  now?: Date
}

/**
 * 签发并发送验证码（PLAN-002 §3.3 / §3.5）。
 *
 * 三道顺序刻意固定：人机验证 → 速率限制 → 是否真的发信。
 * - 人机验证放最前，让脚本连不到限流表，避免攻击者用垃圾请求把真实用户的
 *   IP 窗口刷满（限流本身会成为拒绝服务面）;
 * - 「该邮箱是否应该收到这封信」的判断在最后，且**无论结果如何都返回成功**，
 *   调用方回同一句文案。注册时邮箱已存在、重置时邮箱不存在，都在这里静默跳过发信。
 */
export async function requestVerificationCode(
  input: RequestCodeInput,
): Promise<{ ok: true } | AuthFailure> {
  const now = input.now ?? new Date()
  if (!passesHumanCheck(input, now)) return authFailure('human-check')

  for (const rule of ['codeByIp', 'codeByEmailShort', 'codeByEmailDaily'] as const) {
    const dimension = rule === 'codeByIp' ? 'ip' : 'email'
    const decision = await consumeThrottleSlot({
      rule,
      dimension,
      value: dimension === 'ip' ? input.ip : input.email,
      now,
    })
    if (!decision.allowed) {
      return authFailure('rate-limited', { retryAfterMs: decision.retryAfterMs })
    }
  }

  const existingUser = await findUserByEmail(input.email)
  const shouldSend =
    input.purpose === 'signup' ? existingUser === null : existingUser !== null
  if (!shouldSend) {
    // 有意不发信、也有意回成功：否则「是否收到信」就成了账号枚举通道（§3.4）。
    console.warn('[auth] 验证码请求被静默跳过', { purpose: input.purpose })
    return { ok: true }
  }

  const code = generateVerificationCode()
  await insertVerificationCode({
    email: input.email,
    purpose: input.purpose,
    codeHash: hashVerificationCode({
      code,
      email: input.email,
      purpose: input.purpose,
      key: authSigningKey('verificationCode'),
    }),
    expiresAt: verificationCodeExpiresAt(now),
  })

  const sent = await sendVerificationCodeEmail({
    to: input.email,
    purpose: input.purpose,
    code,
  })
  if (!sent.ok && !shouldHideFailureFromCaller(sent.reason)) {
    // 通道未配置 / 连不上 / 认证失败：对任何邮箱都是同一结果，与「该邮箱是否
    // 注册过」无关，因此如实回 503。不这么做的话 SMTP 挂掉时用户会一直等一封
    // 永远不来的信，而服务端只在日志里留痕（`errors.ts` 的既有口径：如实告知，
    // 不假装已发送）。
    return authFailure('mail-unavailable')
  }
  // 对端在信封阶段拒收这个地址：**与收件人强相关**，必须表现成成功。
  // 注册流程里 shouldSend 取决于邮箱是否已注册，一旦把拒收映射成可区分的响应，
  // 「是否被拒」就成了账号存在性探针（§3.4）。此时码已入库，用户可重试。
  return { ok: true }
}

/**
 * 校验并一次性消费验证码。
 *
 * 失败时递增 `attemptCount`（服务端计数，客户端无法重置）；成功时用带
 * `consumed_at is null` 条件的 UPDATE 原子消费，并发双提交只有一方成功。
 */
export async function consumeVerificationCodeFor(input: {
  email: string
  purpose: VerificationPurpose
  code: string
  now?: Date
}): Promise<{ ok: true } | AuthFailure> {
  const now = input.now ?? new Date()
  const record = await findLatestUnconsumedCode(input.email, input.purpose)
  if (!record) return authFailure('code-invalid')

  const candidateHash = hashVerificationCode({
    code: input.code,
    email: input.email,
    purpose: input.purpose,
    key: authSigningKey('verificationCode'),
  })
  const verdict = checkVerificationCode(record, candidateHash, now)
  if (!verdict.ok) {
    if (verdict.reason === 'mismatch') await incrementVerificationAttempt(record.id)
    return authFailure('code-invalid')
  }
  if (!(await consumeVerificationCode(record.id, now))) return authFailure('code-invalid')
  return { ok: true }
}
