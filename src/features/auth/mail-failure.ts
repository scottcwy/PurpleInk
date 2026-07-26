/**
 * 发信失败的信息泄露分级（纯函数，可不连 SMTP 单测）。
 *
 * 分两类的唯一理由是**泄露性质不同**，不是为了给用户更细的文案：
 *
 * - `channel-unavailable`：未配置 / 连不上 / TLS 失败 / 认证失败 / 超时。
 *   对任何邮箱都是同一结果，与「该邮箱是否注册过」无关，因此可以如实回 503。
 * - `recipient-rejected`：对端在信封阶段拒收这个地址。**与收件人强相关**，
 *   必须对外表现成成功，否则「是否被拒」就成了账号存在性探针
 *   （PLAN-002 §3.4；注册流程的 shouldSend 正是按邮箱是否已注册决定的）。
 */
export type MailSendFailureReason =
  | 'not-configured'
  | 'channel-unavailable'
  | 'recipient-rejected'

/** nodemailer 的传输层错误码：均与收件人无关。 */
const CHANNEL_ERROR_CODES = new Set([
  'ECONNECTION',
  'ESOCKET',
  'ETIMEDOUT',
  'EDNS',
  'EAUTH',
  'ETLS',
  'ECONNREFUSED',
])

/**
 * 判定顺序是「先看传输层错误码，再看 SMTP 响应码」。
 *
 * 反过来会误判：`EAUTH` 也带 5xx `responseCode`（对端拒绝的是我们的账号，
 * 不是收件人），若先看 responseCode 就会被归成 recipient-rejected，
 * 于是 SMTP 口令过期这种全局故障会被静默成 200。
 */
export function classifyMailSendFailure(error: unknown): MailSendFailureReason {
  if (typeof error !== 'object' || error === null) return 'channel-unavailable'
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown }
  if (typeof code === 'string' && CHANNEL_ERROR_CODES.has(code)) return 'channel-unavailable'
  if (typeof responseCode === 'number' && responseCode >= 400) return 'recipient-rejected'
  return 'channel-unavailable'
}

/** 只有收件人相关的失败才对外表现成成功。 */
export function shouldHideFailureFromCaller(reason: MailSendFailureReason): boolean {
  return reason === 'recipient-rejected'
}

/** 诊断日志里允许出现的字段：错误码，不含 provider 原始 response 文本。 */
export function mailErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown'
  const { code } = error as { code?: unknown }
  return typeof code === 'string' && code ? code : 'unknown'
}
