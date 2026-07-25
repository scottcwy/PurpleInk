import { DETERMINISM_RULES } from './rules'

export interface DeterminismViolation {
  ruleId: string
  message: string
  line: number
  snippet: string
}

/** @deprecated 使用语义更明确的 DeterminismViolation。 */
export type Violation = DeterminismViolation

/** 静态扫描 shot 代码字符串，返回确定性违规列表（空数组 = 通过）。 */
export function checkSource(source: string): DeterminismViolation[] {
  const violations: DeterminismViolation[] = []
  const lines = source.split(/\r?\n/)
  lines.forEach((text, index) => {
    for (const rule of DETERMINISM_RULES) {
      if (rule.pattern.test(text)) {
        violations.push({
          ruleId: rule.id,
          message: rule.message,
          line: index + 1,
          snippet: text.trim().slice(0, 120),
        })
      }
    }
  })
  return violations
}

/** 兼容既有调用方；新 Tool 边界优先使用 checkSource。 */
export function checkDeterminism(code: string): Violation[] {
  return checkSource(code)
}

/** 是否确定性合规（无违规）。 */
export function isDeterministic(code: string): boolean {
  return checkSource(code).length === 0
}
