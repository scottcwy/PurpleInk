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
 * 邮件主题色：与主页 design-system.css 同步，并支持客户端明暗色偏好。
 *
 * 邮件客户端对 CSS 变量支持极差，所以色值以内联常量为主；暗色模式通过
 * `<meta name="color-scheme">` + `@media (prefers-color-scheme: dark)` 下发，
 * 不支持的老客户端会优雅回退到浅色主题。
 */
const THEME = {
  light: {
    pageBg: '#f5f5f7',
    cardBg: '#ffffff',
    headerBg: '#171a2e',
    text: '#171a2e',
    muted: '#5e6679',
    divider: '#e5e5e5',
    codeBg: '#f1f4fa',
    codeBorder: '#dde2ee',
    codeText: '#171a2e',
    footer: '#5e6679',
    link: '#5e6679',
    linkHover: '#171a2e',
  },
  dark: {
    pageBg: '#03040a',
    cardBg: '#11131a',
    headerBg: '#03040a',
    text: '#f1f1f4',
    muted: '#9ba0b0',
    divider: '#2a2e3c',
    codeBg: '#191c26',
    codeBorder: '#2a2e3c',
    codeText: '#f1f1f4',
    footer: '#9ba0b0',
    link: '#9ba0b0',
    linkHover: '#f1f1f4',
  },
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

/** 邮件内联 LOGO：与营销页 header 同款 `/svg/logo.svg`，白色版本置于深色 header。 */
const LOGO_SVG =
  `<svg width="120" height="34" viewBox="0 0 167 47" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PurpleInk">` +
  `<rect x="3.5" y="4.5" width="38" height="38" rx="10.5" stroke="white" stroke-width="3"/>` +
  `<path fill-rule="evenodd" clip-rule="evenodd" d="M13 13H24.7C32 13 36.5 16.8 36.5 23.1C36.5 29.4 32 33.2 24.7 33.2H19.2V37H13V13ZM19.2 18.5V27.7H24.3C28.1 27.7 30.2 26.2 30.2 23.1C30.2 20 28.1 18.5 24.3 18.5H19.2Z" fill="white"/>` +
  `<circle cx="36.5" cy="10.5" r="3.5" fill="#00C37A"/>` +
  `<text x="51" y="31.5" fill="white" font-family="Geist, ui-sans-serif, system-ui, sans-serif" font-size="24" font-weight="650" letter-spacing="0">PurpleInk</text>` +
  `</svg>`

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
  const footerLinks = LINKS.map(
    (link) =>
      `<a href="${link.href}" style="color:${THEME.light.link};text-decoration:none;transition:color 0.2s ease">${link.label}</a>`,
  ).join(
    `<span style="color:${THEME.light.divider};padding:0 10px">·</span>`,
  )

  return [
    `<!DOCTYPE html>`,
    `<html lang="zh-CN" style="color-scheme: light dark;">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="supported-color-schemes" content="light dark">`,
    `<title>PurpleInk 验证码</title>`,
    `<!--[if mso]>`,
    `<noscript>`,
    `<xml>`,
    `<o:OfficeDocumentSettings>`,
    `<o:PixelsPerInch>96</o:PixelsPerInch>`,
    `</o:OfficeDocumentSettings>`,
    `</xml>`,
    `</noscript>`,
    `<![endif]-->`,
    `<style>`,
    `:root { color-scheme: light dark; }`,
    `a:hover { color: ${THEME.light.linkHover} !important; text-decoration: underline !important; }`,
    `@media (prefers-color-scheme: dark) {`,
    `  .email-body, .email-body > tbody > tr > td { background-color: ${THEME.dark.pageBg} !important; }`,
    `  .email-shell { background-color: ${THEME.dark.pageBg} !important; }`,
    `  .email-card { background-color: ${THEME.dark.cardBg} !important; }`,
    `  .email-header { background-color: ${THEME.dark.headerBg} !important; }`,
    `  .email-text { color: ${THEME.dark.text} !important; }`,
    `  .email-muted { color: ${THEME.dark.muted} !important; }`,
    `  .email-divider { border-color: ${THEME.dark.divider} !important; }`,
    `  .email-code { background-color: ${THEME.dark.codeBg} !important; border-color: ${THEME.dark.codeBorder} !important; }`,
    `  .email-code-text { color: ${THEME.dark.codeText} !important; }`,
    `  .email-footer { color: ${THEME.dark.footer} !important; }`,
    `  .email-footer a { color: ${THEME.dark.link} !important; }`,
    `  a:hover { color: ${THEME.dark.linkHover} !important; }`,
    `}`,
    `</style>`,
    `</head>`,
    `<body class="email-body" style="margin:0;padding:0;background-color:${THEME.light.pageBg};font-family:${FONT_STACK};">`,
    `<table class="email-body" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${THEME.light.pageBg};">`,
    `<tr><td align="center" style="padding:40px 16px;">`,
    `<table class="email-shell" role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background-color:${THEME.light.pageBg};">`,
    // 卡片
    `<tr><td>`,
    `<table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${THEME.light.cardBg};border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(23,26,46,0.08),0 1px 3px rgba(23,26,46,0.06);">`,
    // 顶部深色 header：LOGO
    `<tr><td class="email-header" style="padding:24px 32px;background-color:${THEME.light.headerBg};">`,
    `<!--[if !mso]><!-->`,
    LOGO_SVG,
    `<!--<![endif]-->`,
    `<!--[if mso]>`,
    `<span style="color:#ffffff;font-family:${FONT_STACK};font-size:20px;font-weight:700;letter-spacing:0.5px;">PurpleInk</span>`,
    `<![endif]-->`,
    `</td></tr>`,
    // 正文
    `<tr><td class="email-text" style="padding:32px;font-family:${FONT_STACK};font-size:15px;line-height:1.7;color:${THEME.light.text};">`,
    `<p style="margin:0 0 20px">${escapeHtml(input.lead)}</p>`,
    // 验证码块
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">`,
    `<tr><td align="center" style="padding:24px 16px;">`,
    `<table class="email-code" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${THEME.light.codeBg};border:1px solid ${THEME.light.codeBorder};border-radius:12px;">`,
    `<tr><td align="center" style="padding:22px 16px;">`,
    `<p class="email-code-text" style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:${THEME.light.codeText};font-family:ui-monospace,'SF Mono',Consolas,monospace">${escapeHtml(input.code)}</p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `<p class="email-muted" style="margin:0 0 24px;color:${THEME.light.muted};font-size:14px">${escapeHtml(input.expiry)}</p>`,
    `<p class="email-divider" style="margin:0 0 20px;border-top:1px solid ${THEME.light.divider};font-size:0;line-height:0">&nbsp;</p>`,
    `<p class="email-muted" style="margin:0;color:${THEME.light.muted};font-size:13px;line-height:1.6">${escapeHtml(input.disclaimer)}</p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    // 页脚
    `<tr><td class="email-footer" align="center" style="padding:24px 16px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.8;color:${THEME.light.footer};">`,
    `<p style="margin:0 0 4px">${footerLinks}</p>`,
    `<p style="margin:0;">Copyright PurpleInk</p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
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
