import { VERIFICATION_CODE_TTL_MS } from './verification-code'
import type { VerificationPurpose } from './verification-code'

/**
 * 验证码邮件文案（中文，无 emoji，AGENTS.md §5）。
 *
 * 纯函数，不碰 SMTP：这样文案可以单测，也能保证正文里除验证码外不含任何
 * 账号状态信息（不暗示该邮箱是否已注册）。
 */
const TTL_MINUTES = Math.round(VERIFICATION_CODE_TTL_MS / 60_000)

const COPY: Record<VerificationPurpose, { subject: string; lead: string }> = {
  signup: {
    subject: 'PurpleInk 注册验证码',
    lead: '你正在创建 PurpleInk 账号，请在页面中填入下面的验证码完成注册。',
  },
  password_reset: {
    subject: 'PurpleInk 重置密码验证码',
    lead: '你正在重置 PurpleInk 账号密码，请在页面中填入下面的验证码继续。',
  },
}

export interface MailBody {
  subject: string
  text: string
  html: string
}

export function verificationCodeMail(input: {
  purpose: VerificationPurpose
  code: string
}): MailBody {
  const { subject, lead } = COPY[input.purpose]
  const expiry = `验证码 ${TTL_MINUTES} 分钟内有效，只能使用一次。`
  const disclaimer = '如果这不是你本人的操作，忽略本邮件即可，账号不会有任何变化。'
  return {
    subject,
    text: [lead, '', input.code, '', expiry, disclaimer].join('\n'),
    html: htmlBody({ lead, code: input.code, expiry, disclaimer }),
  }
}

function htmlBody(input: {
  lead: string
  code: string
  expiry: string
  disclaimer: string
}): string {
  // 内联样式：邮件客户端普遍剥离 <style>，且不能依赖应用侧 ds-* token。
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;',
    'font-size:14px;line-height:1.7;color:#171a2e;max-width:520px">',
    '<p style="margin:0 0 16px">PurpleInk</p>',
    `<p style="margin:0 0 20px">${escapeHtml(input.lead)}</p>`,
    '<p style="margin:0 0 20px;font-size:28px;font-weight:700;letter-spacing:6px;',
    `font-family:ui-monospace,monospace">${escapeHtml(input.code)}</p>`,
    `<p style="margin:0 0 8px;color:#68728f">${escapeHtml(input.expiry)}</p>`,
    `<p style="margin:0;color:#68728f">${escapeHtml(input.disclaimer)}</p>`,
    '</div>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 日志用的收件人脱敏：只保留首字符与域名，避免全量地址落日志
 * （AGENTS.md §6 / PLAN-002 §10 禁区 7）。
 */
export function maskMailbox(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}
