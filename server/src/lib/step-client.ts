// 从 Firenze frameproof/src/lib/agents/step-client.ts 原样拷贝（仅改 logger 导入路径）
import { logger } from "./logger"

/**
 * StepFun Messages API 调用封装（阶跃星辰 step-explore，Anthropic 风格）。
 *
 * 关键约束：当前 API key 有 **RPM 限制（约 10 次/分钟）**，且高频请求下会返回 500 engine_exception。
 * 因此这里统一做两件事：
 *   1. 全局串行 + 最小间隔节流（默认 7s/次 ≈ 8.5 次/分钟，安全低于 10 RPM）
 *   2. 对 429 / 5xx 自动退避重试
 *
 * 采集 Agent 与分镜生成共用本模块，保证整条 pipeline 的调用不会互相挤爆限速。
 */

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

export interface StepMessageOptions {
  system: string
  content: MessageContent[]
  maxTokens: number
  /** 按调用覆盖模型（如视觉用 step-3.7-flash，文本用 step-explore） */
  model?: string
  /** 推理模型思考深度：low/medium/high（step-3.7-flash 等支持）。设置后走 output_config.effort */
  effort?: "low" | "medium" | "high"
}

const MODEL = process.env.STEP_MODEL || "step-explore"
const MIN_INTERVAL_MS = Number(process.env.STEP_MIN_INTERVAL_MS) || 7000
const MAX_RETRIES = Number(process.env.STEP_MAX_RETRIES) || 4

function getConfig() {
  const apiKey = process.env.STEP_API_KEY
  if (!apiKey) throw new Error("STEP_API_KEY not configured")
  return {
    apiKey,
    baseURL: process.env.STEP_BASE_URL || "https://api.stepfun.com/v1",
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 全局串行队列 + 上次调用时间戳，跨 Agent/分镜共享，统一控速
let lastCallAt = 0
let queue: Promise<unknown> = Promise.resolve()

/**
 * 调用 StepFun Messages API，返回首个文本内容。内部已做节流与重试。
 */
export function callStepMessages(opts: StepMessageOptions): Promise<string> {
  const run = queue.then(() => doCall(opts))
  // 无论成功失败都让队列继续
  queue = run.then(() => {}, () => {})
  return run
}

async function doCall(opts: StepMessageOptions): Promise<string> {
  const { apiKey, baseURL } = getConfig()

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 最小间隔节流
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()

    let res: Response
    try {
      res = await fetch(`${baseURL}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.model || MODEL,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.content }],
          // 推理模型（step-3.7-flash）会先产 thinking 块再产 text；effort:low 收敛思考
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        }),
      })
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        logger.warn("step_client:network_error_retry", { attempt, error: String(err) })
        await sleep(4000)
        continue
      }
      throw err
    }

    if (res.ok) {
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>
      }
      return data.content?.find((c) => c.type === "text")?.text || ""
    }

    const errText = await res.text().catch(() => "")
    // 429 限速 / 5xx 服务端异常：退避重试
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const backoff = res.status === 429 ? 12_000 : 4_000
      logger.warn("step_client:retry", { status: res.status, attempt, backoff })
      await sleep(backoff)
      continue
    }

    throw new Error(`StepFun API ${res.status}: ${errText.slice(0, 200)}`)
  }

  throw new Error("StepFun API: exhausted retries")
}
