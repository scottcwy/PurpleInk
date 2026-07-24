// 从 Firenze frameproof/src/lib/agents/imap-email.ts 移植（仅改 logger 导入路径）。
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import { logger } from "../lib/logger"

/**
 * IMAP 真实邮箱收码（QQ 邮箱）
 *
 * agent 自助注册/登录时用真实邮箱接收验证码/激活链接：
 *  1. 真实非一次性域名（@qq.com），能过站点的「禁一次性邮箱」过滤；
 *  2. 验证码/激活邮件能真正投递进来，agent 通过 IMAP 只读收信即可拿到。
 *
 * 通过环境变量配置（QQ 邮箱密码填「授权码」而非登录密码）：
 *   IMAP_HOST / IMAP_PORT / IMAP_SECURE / IMAP_USER / IMAP_PASSWORD
 */

export function isImapConfigured(): boolean {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD)
}

/** 当前配置的真实邮箱地址（未配置返回 null） */
export function imapAddress(): string | null {
  return isImapConfigured() ? process.env.IMAP_USER! : null
}

interface ReadOptions {
  /** 只读取此时间戳之后到达的邮件，避免拿到历史旧码 */
  sinceMs?: number
  timeoutMs?: number
  pollIntervalMs?: number
}

/**
 * 轮询真实邮箱收件箱，等待新邮件并提取验证码/激活链接。
 * @returns 提取到的验证码或激活链接；超时或未配置返回 null。
 */
export async function readImapCode(
  options?: ReadOptions
): Promise<{ code?: string; link?: string } | null> {
  if (!isImapConfigured()) return null

  const timeoutMs = options?.timeoutMs ?? 90_000
  const pollIntervalMs = options?.pollIntervalMs ?? 4_000
  const since = new Date(options?.sinceMs ?? Date.now() - 5 * 60_000)
  const deadline = Date.now() + timeoutMs

  logger.info("imap_email:waiting", { user: mask(process.env.IMAP_USER!), since: since.toISOString() })

  while (Date.now() < deadline) {
    const found = await pollOnce(since)
    if (found) {
      logger.info("imap_email:code_extracted", { ...found })
      return found
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  logger.warn("imap_email:timeout", { user: mask(process.env.IMAP_USER!) })
  return null
}

/** 建立一次连接、扫描 since 之后的新邮件、提取一次；失败返回 null 由外层重试。 */
async function pollOnce(since: Date): Promise<{ code?: string; link?: string } | null> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: (process.env.IMAP_SECURE ?? "true") !== "false",
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASSWORD!,
    },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock("INBOX")
    try {
      const uids = await client.search({ since }, { uid: true })
      if (!uids || uids.length === 0) return null

      const recent = uids.slice(-8).reverse()
      for (const uid of recent) {
        const msg = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true })
        if (!msg || !msg.source) continue
        const arrivedAt = msg.internalDate instanceof Date ? msg.internalDate : null
        if (arrivedAt && arrivedAt.getTime() < since.getTime()) continue
        const parsed = await simpleParser(msg.source)
        const htmlText = typeof parsed.html === "string" ? parsed.html : ""
        const body = `${parsed.subject ?? ""}\n${parsed.text ?? ""}\n${htmlText}`
        const extracted = extractFromBody(body)
        if (extracted) {
          logger.info("imap_email:matched", { uid, arrivedAt: arrivedAt?.toISOString() })
          return extracted
        }
      }
      return null
    } finally {
      lock.release()
    }
  } catch (err) {
    logger.warn("imap_email:poll_failed", { error: String(err) })
    return null
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }
}

function mask(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "***"
  return `${local.slice(0, 2)}***@${domain}`
}

/**
 * 从邮件正文提取验证码或激活链接。
 * 优先级：显式验证码 > 激活/确认链接。
 */
export function extractFromBody(body: string): { code?: string; link?: string } | null {
  const cleaned = body.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")

  const code6 = cleaned.match(
    /(?:code|verification|verify|otp|passcode|验证码|校验码)[^\d]{0,20}(\d{6})\b/i
  )
  if (code6?.[1]) return { code: code6[1] }

  const codeContext = cleaned.match(
    /(?:code|verification|verify|otp|passcode|验证码|校验码)[^\d]{0,20}(\d{4,8})\b/i
  )
  if (codeContext?.[1]) return { code: codeContext[1] }

  const bareCode = cleaned.match(/\b(\d{6})\b/)
  if (bareCode?.[1]) return { code: bareCode[1] }

  const link = body.match(
    /https?:\/\/[^\s"'<>]*(?:verify|confirm|activate|activation|verification)[^\s"'<>]*/i
  )
  if (link?.[0]) return { link: link[0] }

  return null
}
