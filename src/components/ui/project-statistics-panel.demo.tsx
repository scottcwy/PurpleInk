import { ProjectStatisticsPanel } from './project-statistics-panel'
import type { AiUsageProjectionV1 } from '@/features/usage/client'

const API_FIXTURE: AiUsageProjectionV1 = {
  schemaVersion: 1,
  view: 'account',
  range: '7d',
  timeZone: 'Asia/Shanghai',
  coverage: {
    completeFrom: '2026-07-24T00:00:00.000Z',
    includesManagedHistory: false,
    byokHistoryMissing: true,
    attributionComplete: true,
  },
  summary: {
    actualCalls: 21,
    succeeded: 19,
    failed: 2,
    running: 0,
    successRate: 90.5,
    reportedTokens: {
      input: 1200,
      cachedInput: 300,
      output: 640,
      reasoning: 80,
      total: 2220,
    },
    ttsCharacters: 460,
    asrAudioSeconds: 18.2,
    p95DurationMs: 740,
    recentCallAt: '2026-07-30T06:00:00.000Z',
  },
  series: [
    { date: '2026-07-24', managedCalls: 2, ownApiCalls: 1, succeeded: 3, failed: 0, running: 0, reportedTokens: 300, cumulativePercent: null },
    { date: '2026-07-25', managedCalls: 1, ownApiCalls: 2, succeeded: 2, failed: 1, running: 0, reportedTokens: 260, cumulativePercent: null },
    { date: '2026-07-26', managedCalls: 4, ownApiCalls: 0, succeeded: 4, failed: 0, running: 0, reportedTokens: 410, cumulativePercent: null },
    { date: '2026-07-27', managedCalls: 0, ownApiCalls: 2, succeeded: 2, failed: 0, running: 0, reportedTokens: 190, cumulativePercent: null },
    { date: '2026-07-28', managedCalls: 3, ownApiCalls: 1, succeeded: 3, failed: 1, running: 0, reportedTokens: 430, cumulativePercent: null },
    { date: '2026-07-29', managedCalls: 2, ownApiCalls: 1, succeeded: 3, failed: 0, running: 0, reportedTokens: 320, cumulativePercent: null },
    { date: '2026-07-30', managedCalls: 1, ownApiCalls: 1, succeeded: 2, failed: 0, running: 0, reportedTokens: 310, cumulativePercent: null },
  ],
  breakdown: {
    funding: [
      { key: 'managed', label: '平台托管', calls: 13, percent: 61.9 },
      { key: 'byok', label: '自己的 API', calls: 8, percent: 38.1 },
    ],
    provider: [
      { key: 'gemini', label: 'gemini', calls: 12, percent: 57.1 },
      { key: 'stepfun', label: 'stepfun', calls: 9, percent: 42.9 },
    ],
    capability: [
      { key: 'text', label: 'text', calls: 14, percent: 66.7 },
      { key: 'tts', label: 'tts', calls: 7, percent: 33.3 },
    ],
    operation: [
      { key: 'workflow', label: 'workflow', calls: 21, percent: 100 },
    ],
  },
  usageUnavailableCount: 2,
}

export function ProjectStatisticsPanelDemo() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ds-text-muted">
        默认展示项目统计；切换「API 调用统计」可验收 fixture 版式。
      </p>
      <ProjectStatisticsPanel
        metrics={[
          { label: '项目总数', value: '3', source: 'projects.total' },
          { label: '活跃 Pipeline', value: '1', source: 'pipelines.active' },
          { label: '已提交 Artifact', value: '8', source: 'artifacts.committed' },
          { label: '平均镜头数', value: '5.3', source: 'shots.average' },
        ]}
        statusDistribution={{ running: 1, failed: 0, succeeded: 2, idle: 0 }}
        trendUnavailableLabel="尚无历史快照可绘制"
        updatedLabel="Playbook fixture · 项目视图"
        apiUsage={API_FIXTURE}
      />
    </div>
  )
}
