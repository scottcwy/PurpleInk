import { inspectFabricateSource } from '@/features/canvas/contracts'

export function assertDeterministicSource(source: string): void {
  const inspection = inspectFabricateSource(source)
  const violations = inspection.violations
  if (violations.length === 0) return
  const summary = violations
    .map(({ ruleId, line }) => `${ruleId}@${line}`)
    .join(', ')
  throw new Error(`确定性违规：${summary}`)
}
