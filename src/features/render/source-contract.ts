import { checkSource } from '@/lib/determinism'

export function assertDeterministicSource(source: string): void {
  const violations = checkSource(source)
  if (violations.length === 0) return
  const summary = violations
    .map(({ ruleId, line }) => `${ruleId}@${line}`)
    .join(', ')
  throw new Error(`确定性违规：${summary}`)
}
