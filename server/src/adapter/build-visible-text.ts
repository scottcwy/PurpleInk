// snapshots → visible-text.txt。逐行 `[tag] 文本`，对齐金样本格式。
// 数据来自 Firenze snapshot.elements（含登录后各页——比官方多的料）。
import type { StepSnapshot } from "./types"

/** 折叠空白：把换行/连续空格压成单空格并去首尾 */
function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
}

/**
 * 把多步语义快照拼成 visible-text.txt 文本。
 * - 逐个 snapshot 按元素顺序输出 `[tag] text`；
 * - 跳过无文本元素；
 * - 全局去重完全相同的行（重复的导航/按钮不提供额外叙事价值）。
 */
export function buildVisibleText(snapshots: StepSnapshot[]): string {
  const seen = new Set<string>()
  const lines: string[] = []

  for (const snap of snapshots) {
    for (const el of snap.elements) {
      const text = normalizeText(el.text || "")
      if (!text) continue
      const tag = (el.tag || "span").toLowerCase()
      const line = `[${tag}] ${text}`
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }

  return lines.join("\n") + "\n"
}
