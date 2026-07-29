import type {
  AiUsageBreakdownRow,
  AiUsageProjectionV1,
  AiUsageView,
} from './contracts'

export interface UsageRow {
  status: string
  provider: string
  funding: string
  capability: string | null
  operation: string
  usage: unknown
  usageStatus: string | null
  telemetryVersion: number
  startedAt: Date | null
  durationMs: number | null
  localDate: string | null
  settledCnyMicros: bigint | null
}

export type ActualUsageRow = UsageRow & { startedAt: Date }

export function isActualUsageRow(row: UsageRow): row is ActualUsageRow {
  return row.startedAt !== null
}

export function summarize(
  rows: ActualUsageRow[],
): AiUsageProjectionV1['summary'] {
  const succeeded = rows.filter((row) => row.status === 'succeeded').length
  const running = rows.filter((row) => row.status === 'running').length
  const failed = rows.length - succeeded - running
  const terminal = succeeded + failed
  const tokens = rows.reduce((total, row) => addUsage(total, row), emptyUsage())
  const durations = rows
    .map((row) => row.telemetryVersion >= 2 ? row.durationMs : null)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)
  const recent = rows.reduce<Date | null>(
    (latest, row) => !latest || row.startedAt > latest ? row.startedAt : latest,
    null,
  )

  return {
    actualCalls: rows.length,
    succeeded,
    failed,
    running,
    successRate: terminal === 0 ? null : round(succeeded * 100 / terminal, 1),
    reportedTokens: {
      input: tokens.input,
      cachedInput: tokens.cached,
      output: tokens.output,
      reasoning: tokens.reasoning,
      total: tokens.input + tokens.cached + tokens.output + tokens.reasoning,
    },
    ttsCharacters: tokens.ttsCharacters,
    asrAudioSeconds: round(tokens.asrSeconds, 3),
    p95DurationMs: durations.length < 2
      ? null
      : durations[Math.ceil(durations.length * 0.95) - 1]!,
    recentCallAt: recent?.toISOString() ?? null,
  }
}

export function buildSeries(
  rows: UsageRow[],
  dateKeys: string[],
  limit: bigint | null,
  view: AiUsageView,
): AiUsageProjectionV1['series'] {
  let cumulative = BigInt(0)
  return dateKeys.map((date) => {
    const daily = rows.filter((row) => row.localDate === date)
    const actual = daily.filter(isActualUsageRow)
    for (const row of daily) {
      cumulative += row.settledCnyMicros ?? BigInt(0)
    }
    const summary = summarize(actual)
    return {
      date,
      managedCalls: actual.filter((row) => row.funding === 'managed').length,
      ownApiCalls: actual.filter((row) => row.funding !== 'managed').length,
      succeeded: summary.succeeded,
      failed: summary.failed,
      running: summary.running,
      reportedTokens: summary.reportedTokens.total,
      cumulativePercent: view === 'managed-cycle'
        ? quotaPercent(cumulative, limit ?? BigInt(0))
        : null,
    }
  })
}

export function breakdown(
  rows: ActualUsageRow[],
  key: 'funding' | 'provider' | 'capability' | 'operation',
): AiUsageBreakdownRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[key] ?? 'unknown'
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, calls]) => ({
      key: value,
      label: breakdownLabel(key, value),
      calls,
      percent: rows.length === 0 ? 0 : round(calls * 100 / rows.length, 1),
    }))
}

interface UsageTotals {
  input: number
  cached: number
  output: number
  reasoning: number
  ttsCharacters: number
  asrSeconds: number
}

function addUsage(total: UsageTotals, row: UsageRow): UsageTotals {
  if (row.usageStatus !== 'reported' || !isRecord(row.usage)) return total
  return {
    input: total.input + number(row.usage.inputTokens),
    cached: total.cached + number(row.usage.cachedInputTokens),
    output: total.output + number(row.usage.outputTokens),
    reasoning: total.reasoning + number(row.usage.reasoningTokens),
    ttsCharacters: total.ttsCharacters + number(row.usage.inputCharacters),
    asrSeconds: total.asrSeconds + number(row.usage.inputAudioSeconds),
  }
}

function emptyUsage(): UsageTotals {
  return {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    ttsCharacters: 0,
    asrSeconds: 0,
  }
}

function quotaPercent(used: bigint, limit: bigint): number {
  if (limit <= BigInt(0)) return used > BigInt(0) ? 100 : 0
  return Math.min(100, Number(used * BigInt(10_000) / limit) / 100)
}

function breakdownLabel(kind: string, value: string): string {
  if (kind === 'funding') {
    return value === 'managed' ? '平台托管' : '自己的 API'
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
