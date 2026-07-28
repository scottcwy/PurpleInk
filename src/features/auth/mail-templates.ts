import { VERIFICATION_CODE_TTL_MS } from './verification-code'
import type { VerificationPurpose } from './verification-code'

/**
 * 验证码邮件文案（中文，无 emoji，AGENTS.md §5）。
 *
 * 纯函数，不碰 SMTP：这样文案可以单测，也能保证正文里除验证码外不含任何
 * 账号状态信息（不暗示该邮箱是否已注册）。
 */
const TTL_MINUTES = Math.round(VERIFICATION_CODE_TTL_MS / 60_000)

/**
 * 品牌色：与营销页 footer / bottom-cta 的靛蓝渐变光谱一致
 * （#333DA7 → #6366f1 → #a5b4fc）。邮件客户端普遍剥离 <style>，
 * 也无法引用应用侧 ds-* token，所以色值以常量形式内联。
 */
const BRAND = {
  ink: '#333da7',
  accent: '#6366f1',
  accentLight: '#a5b4fc',
  accentFill: '#eef0ff',
  accentBorder: '#d6dcff',
  pageBg: '#f5f5f7',
  cardBg: '#ffffff',
  text: '#171a2e',
  muted: '#737373',
  divider: '#e5e5e5',
} as const

const LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: '官网', href: 'https://purpleink.cn' },
  { label: '文档', href: 'https://docs.purpleink.cn' },
  { label: '联系我们', href: 'mailto:support@purpleink.cn' },
]

const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif`

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
  const textFooter = LINKS.map((link) => `${link.label}：${link.href}`).join('\n')
  return {
    subject,
    text: [lead, '', input.code, '', expiry, disclaimer, '', '—', textFooter].join('\n'),
    html: htmlBody({ lead, code: input.code, expiry, disclaimer }),
  }
}

function htmlBody(input: {
  lead: string
  code: string
  expiry: string
  disclaimer: string
}): string {
  // table + 内联样式：邮件客户端普遍剥离 <style>，Outlook 只认 table 布局。
  // 渐变均给 background-color 纯色兜底，老客户端优雅降级。
  const footerLinks = LINKS.map(
    (link) =>
      `<a href="${link.href}" style="color:${BRAND.muted};text-decoration:underline">${link.label}</a>`,
  ).join(
    `<span style="color:${BRAND.divider};padding:0 10px">·</span>`,
  )
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.pageBg};padding:40px 16px">`,
    '<tr><td align="center">',
    '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px">',
    // 卡片
    '<tr><td>',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cardBg};border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(23,26,46,0.08),0 1px 3px rgba(23,26,46,0.06)">`,
    // 顶部品牌渐变光带（复用首页 footer 光谱）
    `<tr><td height="4" style="height:4px;font-size:0;line-height:0;background-color:${BRAND.accent};background-image:linear-gradient(90deg,${BRAND.ink},${BRAND.accent},${BRAND.accentLight});border-radius:16px 16px 0 0">&nbsp;</td></tr>`,
    // 头部淡靛蓝光晕 + wordmark
    `<tr><td style="padding:28px 32px 0;background-color:${BRAND.cardBg};background-image:linear-gradient(180deg,${BRAND.accentFill} 0%,${BRAND.cardBg} 100%)">`,
    `<p style="margin:0;font-family:${FONT_STACK};font-size:18px;font-weight:700;letter-spacing:2px;color:${BRAND.ink}">PurpleInk</p>`,
    '</td></tr>',
    // 正文
    `<tr><td style="padding:20px 32px 32px;font-family:${FONT_STACK};font-size:14px;line-height:1.7;color:${BRAND.text}">`,
    `<p style="margin:0 0 20px">${escapeHtml(input.lead)}</p>`,
    // 验证码块：浅靛蓝底 + 顶部受光高光线
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">',
    `<tr><td align="center" style="padding:20px 16px;background-color:${BRAND.accentFill};border:1px solid ${BRAND.accentBorder};border-radius:12px;box-shadow:inset 0 1px 0 ${BRAND.cardBg}">`,
    `<p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:${BRAND.ink};font-family:ui-monospace,'SF Mono',Consolas,monospace">${escapeHtml(input.code)}</p>`,
    '</td></tr>',
    '</table>',
    `<p style="margin:0 0 24px;color:${BRAND.muted}">${escapeHtml(input.expiry)}</p>`,
    `<p style="margin:0 0 16px;border-top:1px solid ${BRAND.divider};font-size:0;line-height:0">&nbsp;</p>`,
    `<p style="margin:0;color:${BRAND.muted};font-size:13px">${escapeHtml(input.disclaimer)}</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    // 卡片外页脚：官网 / 文档 / 联系我们
    `<tr><td align="center" style="padding:24px 16px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.8;color:${BRAND.muted}">`,
    `<p style="margin:0 0 4px">${footerLinks}</p>`,
    `<p style="margin:0;color:${BRAND.muted}">Copyright PurpleInk</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
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
