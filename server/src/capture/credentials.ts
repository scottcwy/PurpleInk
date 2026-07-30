// 从 Firenze frameproof/src/lib/agents/credentials.ts 移植（仅改导入路径）。
import { logger } from "../lib/logger"
import { isImapConfigured, imapAddress, readImapCode } from "./imap-email"

/**
 * Agent 登录/注册凭据
 *
 * - "user" 模式：用户在创建项目时提供了测试账号 → 直接使用，优先走登录流程。
 * - "auto" 模式：用户未提供 → 用 IMAP 真实邮箱（QQ）生成账号，走注册流程；
 *   通过 fetchEmailCode() 自动读取邮箱验证码/激活链接。
 *
 * 注册链路只支持 IMAP 真实邮箱：未配置 IMAP 且用户未提供账号时，resolveCredentials
 * 返回 null，agent 不进行登录/注册，仅采集公开可见内容。
 */
export interface AgentCredentials {
  mode: "user" | "auto"
  email: string
  password: string
  name: string
  /** 是否具备读取邮箱验证码/激活链接的能力（决定是否引导 {{code}}/verify_email） */
  canReadEmail: boolean
  /** 拉取邮箱验证码/激活链接；无邮箱读取能力时返回 null */
  fetchEmailCode: () => Promise<{ code?: string; link?: string } | null>
}

export type CredentialMode = "legacy" | "public" | "none"

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Sam", "Jamie"]
const LAST_NAMES = ["Lee", "Chen", "Kim", "Park", "Wang", "Smith", "Brown", "Davis"]

function randomName(): string {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${f} ${l}`
}

function strongPassword(): string {
  return `Fp!${Math.random().toString(36).slice(2, 10)}${Math.floor(Math.random() * 90 + 10)}A`
}

/**
 * 根据项目配置解析出一套可用凭据。优先级：
 * 1. 用户提供 testEmail + testPassword → user 模式（登录优先）；
 *    若同时配了 IMAP，登录环节若触发邮箱验证也能读真实信箱的码。
 * 2. 未提供账号但配了 IMAP 真实邮箱（QQ）→ auto 模式，用真实邮箱自助注册，
 *    通过 IMAP 读验证码/激活链接（真·自助注册，能过“禁一次性邮箱”过滤）。
 * 3. 以上都没有 → 返回 null，agent 不做登录/注册，仅采集公开内容。
 */
export async function resolveCredentials(project: {
  /** omit/legacy 保持原行为；public/none 明确禁用登录、注册与 IMAP。 */
  credentialMode?: CredentialMode
  testEmail?: string | null
  testPassword?: string | null
}): Promise<AgentCredentials | null> {
  if (project.credentialMode === "public" || project.credentialMode === "none") {
    logger.info("credentials:none", { reason: "public capture mode" })
    return null
  }

  // 注册/登录提交发生在采集中后段，验证邮件那时才到；以本凭据创建时间为下界，
  // 只读此后到达的邮件，避免拿到历史旧码。
  const startedAt = Date.now()
  const imapOn = isImapConfigured()
  const imapFetch = async () =>
    readImapCode({ sinceMs: startedAt - 60_000, timeoutMs: 90_000, pollIntervalMs: 4_000 })

  // 1. 用户提供了账号 → 登录优先
  if (project.testEmail && project.testPassword) {
    logger.info("credentials:using_user_provided", { email: mask(project.testEmail), imap: imapOn })
    return {
      mode: "user",
      email: project.testEmail,
      password: project.testPassword,
      name: randomName(),
      canReadEmail: imapOn,
      fetchEmailCode: imapOn ? imapFetch : async () => null,
    }
  }

  // 2. 配了真实 IMAP 邮箱（QQ）→ 用它自助注册（密码固定，重跑同站能转登录）
  if (imapOn) {
    const email = imapAddress()!
    const password = process.env.SIGNUP_PASSWORD || strongPassword()
    logger.info("credentials:using_imap_mailbox", { email: mask(email) })
    return {
      mode: "auto",
      email,
      password,
      name: randomName(),
      canReadEmail: true,
      fetchEmailCode: imapFetch,
    }
  }

  // 3. 既无用户账号也无 IMAP → 无凭据，不登录/注册
  logger.info("credentials:none", { reason: "no user account and IMAP not configured" })
  return null
}

function mask(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "***"
  return `${local!.slice(0, 2)}***@${domain}`
}
