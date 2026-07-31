import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * 零第三方依赖的人机验证（PLAN-002 §1.6）。三道一起启用：
 * 1. 蜜罐字段——正常用户永远为空；
 * 2. 签名时间戳——服务端下发 `issuedAt` 并 HMAC 签名，提交时校验签名与停留时长；
 * 3. 算术验证码——题目以 SVG 呈现，答案只以带密钥摘要进 token，不落库。
 *
 * 三项都不足以单独挡住定向攻击，组合起来对脚本刷量够用；真正的兜底是
 * `throttle.ts` 的按 IP / 按邮箱速率限制。
 */
export const HUMAN_CHECK_MIN_DWELL_MS = 1_500
export const HUMAN_CHECK_MAX_DWELL_MS = 10 * 60 * 1000

const TOKEN_DOMAIN = 'cvc.auth.human-check/v1'
const ANSWER_DIGEST_BYTES = 16
const TOKEN_FIELD_COUNT = 3

export interface ArithmeticChallenge {
  question: string
  answer: string
}

/** 题目保持在心算范围内，且答案恒为非负整数（减法自动排大小）。 */
export function createArithmeticChallenge(): ArithmeticChallenge {
  const operator = (['+', '-', '×'] as const)[randomInt(0, 3)]!
  if (operator === '×') {
    const left = randomInt(2, 10)
    const right = randomInt(2, 10)
    return { question: `${left} × ${right}`, answer: String(left * right) }
  }
  if (operator === '-') {
    const left = randomInt(10, 30)
    const right = randomInt(1, left)
    return { question: `${left} - ${right}`, answer: String(left - right) }
  }
  const left = randomInt(1, 20)
  const right = randomInt(1, 20)
  return { question: `${left} + ${right}`, answer: String(left + right) }
}

/** token 形如 `issuedAtMs.answerDigest.signature`；三段都是 URL 安全字符。 */
export function issueHumanCheckToken(input: {
  answer: string
  issuedAt: Date
  key: Uint8Array
}): string {
  const issuedAt = String(input.issuedAt.getTime())
  const answerDigest = digestAnswer(input.answer, input.key)
  return [issuedAt, answerDigest, sign(`${issuedAt}.${answerDigest}`, input.key)].join('.')
}

export type HumanCheckFailureReason =
  | 'honeypot'
  | 'malformed'
  | 'tampered'
  | 'too-fast'
  | 'expired'
  | 'wrong-answer'

export type HumanCheckResult = { ok: true } | { ok: false; reason: HumanCheckFailureReason }

/**
 * 组合校验。对外只回「通过 / 不通过」，`reason` 仅用于服务端日志分类，
 * **不得回给客户端**（§3.4：不解释具体哪一项失败）。
 */
export function verifyHumanCheck(input: {
  token: string
  answer: string
  honeypot?: string
  now: Date
  key: Uint8Array
}): HumanCheckResult {
  if (input.honeypot && input.honeypot.trim().length > 0) {
    return { ok: false, reason: 'honeypot' }
  }
  const parts = typeof input.token === 'string' ? input.token.split('.') : []
  if (parts.length !== TOKEN_FIELD_COUNT) return { ok: false, reason: 'malformed' }
  const [issuedAt, answerDigest, signature] = parts as [string, string, string]
  const issuedAtMs = Number(issuedAt)
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    return { ok: false, reason: 'malformed' }
  }
  if (!/^[0-9a-f]{32}$/.test(answerDigest)) return { ok: false, reason: 'malformed' }
  if (!hexEqual(signature, sign(`${issuedAt}.${answerDigest}`, input.key))) {
    return { ok: false, reason: 'tampered' }
  }
  const dwellMs = input.now.getTime() - issuedAtMs
  if (dwellMs < HUMAN_CHECK_MIN_DWELL_MS) return { ok: false, reason: 'too-fast' }
  if (dwellMs > HUMAN_CHECK_MAX_DWELL_MS) return { ok: false, reason: 'expired' }
  if (!hexEqual(answerDigest, digestAnswer(input.answer, input.key))) {
    return { ok: false, reason: 'wrong-answer' }
  }
  return { ok: true }
}

/**
 * 手写字符串拼接的 SVG，不引入 canvas / 图形库。
 * 题目本身可被读屏软件读出（`role="img"` + `aria-label`），因此算术验证码天然
 * 具备非视觉替代，不需要额外音频通道（AGENTS.md §6：状态不能只靠颜色/图像表达）。
 */
export function renderChallengeSvg(question: string): string {
  const safe = escapeXml(question)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="132" height="44" viewBox="0 0 132 44"',
    ` role="img" aria-label="请计算：${safe}">`,
    '<rect width="132" height="44" rx="6" fill="#e8ecfa"/>',
    '<path d="M6 33 L44 12 M52 34 L96 9 M104 32 L126 14" stroke="#68728f"',
    ' stroke-width="1" opacity="0.45" fill="none"/>',
    '<text x="66" y="29" text-anchor="middle" font-family="ui-monospace, monospace"',
    ` font-size="19" letter-spacing="2" fill="#171a2e">${safe}</text>`,
    '</svg>',
  ].join('')
}

function digestAnswer(answer: string, key: Uint8Array): string {
  return createHmac('sha256', key)
    .update(`${TOKEN_DOMAIN}\u0000answer\u0000${String(answer ?? '').trim()}`, 'utf8')
    .digest('hex')
    .slice(0, ANSWER_DIGEST_BYTES * 2)
}

function sign(payload: string, key: Uint8Array): string {
  return createHmac('sha256', key)
    .update(`${TOKEN_DOMAIN}\u0000token\u0000${payload}`, 'utf8')
    .digest('hex')
}

function hexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
