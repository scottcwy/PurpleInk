import { validateShotPlanValue } from './tools/validate-shot-plan'

/**
 * 工具产物的文本抢救。
 *
 * 存在原因：模型有时把「本应通过工具提交的实参」直接当作 assistant 文本输出
 * （实测 SHOT_SPEC 阶段高频发生）。此时内容本身可能完全合规，硬失败只是浪费一次真实模型调用。
 *
 * 抢救的唯一合法方式是**复用同一套可信校验器**：
 * shot plan 走 `validateShotPlanValue`（与 `validate_shot_plan` 工具同一函数），
 * HTML 只做「必须是完整文档」的形状判定，真正的确定性红线仍由产物门禁
 * （`write-artifact` 的 `deterministic-html` 校验）执行。
 * 本模块不放宽任何门禁，只是把合规内容从另一条传输通道里取出来。
 */

const FENCE = /^```[^\n]*\n([\s\S]*)\n```$/

/** 剥掉成对的 Markdown 代码围栏；未成对时只做首尾空白裁剪，不猜测内容。 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const matched = FENCE.exec(trimmed)
  return matched?.[1] ?? trimmed
}

/**
 * 从 assistant 文本抢救 `validate_shot_plan` 的 `shotPlan` 实参。
 * 同时接受工具实参信封（`{ shotPlan: ... }`）与裸 shot plan 对象。
 */
export function recoverShotPlanArgument(text: string): string | null {
  const parsed = parseJsonObject(stripCodeFences(text))
  if (!parsed) return null
  const candidate: unknown = Object.hasOwn(parsed, 'shotPlan')
    ? parsed.shotPlan
    : parsed
  if (!validateShotPlanValue(candidate).ok) return null
  return serialize(candidate)
}

/**
 * 从 assistant 文本抢救 `check_determinism` 的 `source` 实参。
 * 只判定「是完整 HTML 文档」，确定性检测仍由下游可信门禁负责。
 */
export function recoverDeterministicSourceArgument(text: string): string | null {
  const stripped = stripCodeFences(text)
  const textualToolCall = stripped.match(
    /^<tool_call>\s*<function=check_determinism>\s*<parameter=source>\s*([\s\S]*?)\s*<\/parameter>\s*<\/function>\s*<\/tool_call>$/u
  )
  if (stripped.startsWith('<tool_call>') && !textualToolCall) return null
  const html = textualToolCall?.[1]?.trim() ?? stripped
  if (!html.startsWith('<') || !html.endsWith('>')) return null
  return html
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith('{')) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function serialize(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
