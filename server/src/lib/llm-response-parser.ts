// 从 Firenze frameproof/src/lib/utils/llm-response-parser.ts 原样拷贝
import { logger } from "./logger"

/**
 * 从 LLM 响应中解析 JSON。
 * 处理 markdown 代码块包裹、前后缀杂文等常见情况。
 * 解析失败时返回 fallback（默认 undefined）。
 */
export function parseLlmJson<T>(raw: string | null | undefined, fallback?: T): T {
  if (!raw) {
    if (fallback !== undefined) return fallback
    throw new Error("LLM response is empty")
  }

  // 去除 markdown 代码块包裹
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

  // 尝试提取第一个完整 JSON 结构（对象或数组）
  const objStart = cleaned.indexOf("{")
  const arrStart = cleaned.indexOf("[")

  if (objStart === -1 && arrStart === -1) {
    if (fallback !== undefined) return fallback
    throw new Error(`No JSON structure found in LLM response: ${cleaned.substring(0, 100)}`)
  }

  // 选取最靠前的 JSON 起始位置
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart)
  cleaned = cleaned.substring(start)

  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    logger.warn("llm_parser:json_parse_failed", {
      error: String(err),
      preview: cleaned.substring(0, 200),
    })
    if (fallback !== undefined) return fallback
    throw new Error(`Failed to parse LLM JSON: ${String(err)}`)
  }
}
