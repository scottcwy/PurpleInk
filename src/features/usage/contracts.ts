export type AiUsageView = 'account' | 'managed-cycle'
export type AiUsageRange = '7d' | '30d' | 'cycle'

export interface AiUsageProjectionV1 {
  schemaVersion: 1
  view: AiUsageView
  range: AiUsageRange
  timeZone: string
  coverage: {
    completeFrom: string
    includesManagedHistory: boolean
    byokHistoryMissing: boolean
    attributionComplete: boolean
  }
  summary: {
    actualCalls: number
    succeeded: number
    failed: number
    running: number
    successRate: number | null
    reportedTokens: {
      input: number
      cachedInput: number
      output: number
      reasoning: number
      total: number
    }
    ttsCharacters: number
    asrAudioSeconds: number
    p95DurationMs: number | null
    recentCallAt: string | null
  }
  series: Array<{
    date: string
    managedCalls: number
    ownApiCalls: number
    succeeded: number
    failed: number
    running: number
    reportedTokens: number
    cumulativePercent: number | null
  }>
  breakdown: {
    funding: AiUsageBreakdownRow[]
    provider: AiUsageBreakdownRow[]
    capability: AiUsageBreakdownRow[]
    operation: AiUsageBreakdownRow[]
  }
  usageUnavailableCount: number
}

export interface AiUsageBreakdownRow {
  key: string
  label: string
  calls: number
  percent: number
}
