import 'server-only'
import { createTransport, type Transporter } from 'nodemailer'
import { maskMailbox, verificationCodeMail } from './mail-templates'
import type { VerificationPurpose } from './verification-code'

/**
 * 出站邮件的唯一出口（PLAN-002 §1.5）。
 *
 * 通道是阿里云邮件推送的标准 SMTP 接入 + `nodemailer`（精确锁版）。
 * 手写 SMTP 客户端（STARTTLS + AUTH LOGIN + 行折叠 + 编码）约 150 行且易错，
 * 收益为负。
 *
 * env 归属：**Next 侧不读 `server/.env`**。真实值由用户从 `server/.env` 复制到
 * 被 git 忽略的根 `.env.local` 的 `CVC_MAIL_*`，与 `GEMINI_API_KEY` /
 * `STEPFUN_API_KEY` 既有的「各自为政 + 值复制」先例一致
 * （`docs/configuration/credentials.md`）。
 *
 * 与 `server/src/capture/imap-email.ts` 零交集：那边是采集 agent **收信**
 * （出站登录被演示站点时读对方的验证码），方向相反，不得复用（§6）。
 */
export interface MailConfig {
  host: string
  port: number
  user: string
  pass: string
  fromAddress: string
  fromName: string
}

/**
 * 读取邮件通道配置。任何一项缺失都返回 null——**不做部分降级**：
 * 半配置的通道会让「发信静默失败」，用户以为收不到码是网络问题。
 */
export function readMailConfig(): MailConfig | null {
  const host = process.env.CVC_MAIL_SMTP_HOST?.trim()
  const port = Number(process.env.CVC_MAIL_SMTP_PORT?.trim())
  const user = process.env.CVC_MAIL_SMTP_USER?.trim()
  const pass = process.env.CVC_MAIL_SMTP_PASS
  const fromAddress = process.env.CVC_MAIL_FROM_ADDRESS?.trim() || user
  const fromName = process.env.CVC_MAIL_FROM_NAME?.trim() || 'PurpleInk'
  if (!host || !user || !pass || !fromAddress) return null
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { host, port, user, pass, fromAddress, fromName }
}

export function isMailChannelConfigured(): boolean {
  return readMailConfig() !== null
}

const globalStore = globalThis as unknown as { __cvcMailTransport?: Transporter }

function transport(config: MailConfig): Transporter {
  globalStore.__cvcMailTransport ??= createTransport({
    host: config.host,
    port: config.port,
    // 465 是隐式 TLS；其余端口走 STARTTLS 升级。
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass },
  })
  return globalStore.__cvcMailTransport
}

export type MailSendResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'send-failed' }

/**
 * 发送验证码邮件。
 *
 * 失败只回类别，不回 provider 原始错误（AGENTS.md §6）。日志里既不记验证码，
 * 也不记收件人全量地址——只记脱敏邮箱与用途。
 */
export async function sendVerificationCodeEmail(input: {
  to: string
  purpose: VerificationPurpose
  code: string
}): Promise<MailSendResult> {
  const config = readMailConfig()
  if (!config) {
    console.error('[auth] 邮件通道未配置，验证码未发送', { purpose: input.purpose })
    return { ok: false, reason: 'not-configured' }
  }
  const body = verificationCodeMail({ purpose: input.purpose, code: input.code })
  try {
    await transport(config).sendMail({
      from: { name: config.fromName, address: config.fromAddress },
      to: input.to,
      subject: body.subject,
      text: body.text,
      html: body.html,
    })
    return { ok: true }
  } catch (error) {
    console.error('[auth] 验证码邮件发送失败', {
      purpose: input.purpose,
      mailbox: maskMailbox(input.to),
      cause: error instanceof Error ? error.name : 'unknown',
    })
    return { ok: false, reason: 'send-failed' }
  }
}
