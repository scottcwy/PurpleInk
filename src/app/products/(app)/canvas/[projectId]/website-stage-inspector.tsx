'use client'

import { Fragment, useState } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  SettingsGroup,
  SettingsSeparator,
} from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import type { CanvasGraphNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import { useLocalTimeZone } from '@/lib/hooks/use-local-time-zone'
import {
  parseWebsiteExecution,
  WEBSITE_INSPECTOR_TABS,
  type WebsiteExecutionProjection,
  type WebsiteInspectorTab,
} from './website-stage-inspector-data'
import { projectExecutionLabel } from './website-execution-presentation'

const PHASE_LABEL: Record<string, string> = {
  capture: '网站采集',
  script: '介绍脚本',
  narration: '旁白生成',
  compose: '画面合成',
  render: '视频渲染',
  export: '成片验收与导出',
}

const STATE_LABEL: Record<string, string> = {
  queued: '已排队',
  running: '执行中',
  succeeded: '已完成',
  blocked: '质量验收阻塞',
  failed: '失败',
  cancelled: '已取消',
  idle: '未启动',
}

export function WebsiteStageInspector({
  node,
  execution,
}: {
  node: Pick<CanvasGraphNode, 'data'>
  execution: ProjectExecutionSnapshot
}) {
  const [tab, setTab] = useState<WebsiteInspectorTab>('data')
  const timeZone = useLocalTimeZone()
  const projection = parseWebsiteExecution(node.data)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ds-text">网站执行机制</h3>
          <p className="mt-1 text-[11px] leading-4 text-ds-text-muted">
            阶段检查点投影，不是逐秒 worker 日志
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ds-blue-soft px-2 py-1 text-[10px] font-medium text-ds-blue">
          安全投影
        </span>
      </div>
      <SegmentedControl
        options={[...WEBSITE_INSPECTOR_TABS]}
        value={tab}
        onChange={(value) => {
          if (isWebsiteInspectorTab(value)) setTab(value)
        }}
        className="grid w-full grid-cols-4 [&>button]:px-1.5"
      />
      <p className="text-[11px] leading-4 text-ds-text-muted">
        {tabDescription(tab)}
      </p>
      {renderTab(tab, projection, execution, timeZone)}
    </section>
  )
}

function renderTab(
  tab: WebsiteInspectorTab,
  projection: WebsiteExecutionProjection | undefined,
  execution: ProjectExecutionSnapshot,
  timeZone: string,
) {
  if (tab === 'source') {
    return (
      <FactGroup
        facts={[
          ['输入来源', '公开 URL（完整地址仅服务端）'],
          ['生产默认路径', 'Playwright Chromium'],
          ['浏览器合同', 'Headless · 1280×720 @2×'],
          ['凭据模式', '匿名采集 · none'],
        ]}
      />
    )
  }
  if (tab === 'gates') {
    return (
      <FactGroup
        facts={[
          ['网络门禁', '入口 / 跳转 / 子请求'],
          ['DNS 策略', '公网地址 fail-closed'],
          ['敏感数据', 'Header / Cookie / DOM 禁止投影'],
          ['缓存策略', 'Attempt + URL SHA-256 隔离'],
        ]}
      />
    )
  }
  if (tab === 'execution') {
    return (
      <FactGroup
        facts={[
          ['当前耗时', formatSeconds(projection?.elapsedSec)],
          ['目标时长', formatDuration(projection)],
          ['引擎截止', '45 分钟'],
          ['队列保护', '50 分钟 · 30 秒心跳'],
          ['验证结果', verificationLabel(projection?.verification)],
          ['容器校验', checkLabel(projection?.verification?.checkPassed)],
          ['金样本校验', checkLabel(projection?.verification?.goldenVerified)],
          ['最终产物', artifactLabel(projection?.artifact)],
          ['Artifact 状态', deliveryLabel(execution)],
        ]}
      />
    )
  }
  return (
    <FactGroup
      facts={[
        ['项目执行状态', projectExecutionLabel(execution.state)],
        ['工作流阶段', readLabel(PHASE_LABEL, projection?.phase)],
        ['投影状态', readLabel(STATE_LABEL, projection?.state)],
        ['引擎检查点', enginePhaseLabel(projection?.enginePhase)],
        ['同步时间', formatTimestamp(projection?.updatedAt, timeZone)],
        ['安全失败码', projection?.failureCode ?? '无'],
      ]}
    />
  )
}

function FactGroup({ facts }: { facts: ReadonlyArray<readonly [string, string]> }) {
  return (
    <SettingsGroup>
      {facts.map(([label, value], index) => (
        <Fragment key={label}>
          {index > 0 && <SettingsSeparator />}
          <SettingsRow label={label} value={value} chevron={false} />
        </Fragment>
      ))}
    </SettingsGroup>
  )
}

function tabDescription(tab: WebsiteInspectorTab): string {
  if (tab === 'data') return '仅显示本节点已持久化的运行白名单。'
  if (tab === 'source') return '以下是版本内默认合同，不冒充本次驱动证明。'
  if (tab === 'gates') return '采集前及每次网络跳转都受同一安全边界约束。'
  return '运行事实来自检查点；超时、心跳与缓存为版本策略。'
}

function readLabel(
  labels: Record<string, string>,
  value: string | undefined,
): string {
  return value ? labels[value] ?? value : '等待受控 worker 回传'
}

function formatSeconds(value: number | undefined): string {
  return value === undefined ? '等待受控 worker 回传' : `${value.toFixed(1)} 秒`
}

function formatDuration(
  projection: WebsiteExecutionProjection | undefined,
): string {
  if (projection?.durationSec === undefined) return '等待受控 worker 回传'
  const source = projection.durationSource === 'output' ? '输出实测' : '请求目标'
  return `${projection.durationSec} 秒 · ${source}`
}

function verificationLabel(
  value: WebsiteExecutionProjection['verification'],
): string {
  if (!value?.outcome) return '等待最终验证'
  const outcome = value.outcome === 'passed' ? '通过' : '降级'
  const checks =
    value.goldenCheckCount === undefined ? '' : ` · ${value.goldenCheckCount} 项金样本`
  return `${outcome}${checks}`
}

function checkLabel(value: boolean | undefined): string {
  if (value === undefined) return '等待校验'
  return value ? '通过' : '未通过'
}

function deliveryLabel(execution: ProjectExecutionSnapshot): string {
  const delivery = execution.delivery
  if (!delivery) return '等待真实 MP4 Artifact'
  return `${delivery.lifecycle} · v${delivery.version}`
}

function enginePhaseLabel(value: string | undefined): string {
  if (!value) return '等待受控 worker 回传'
  return {
    queued: '等待执行器',
    capturing: '正在采集网站',
    scripting: '正在生成介绍脚本',
    synthesizing: '正在生成旁白',
    timing: '正在对齐旁白时序',
    composing: '正在合成画面',
    rendering: '正在渲染视频',
    verifying: '正在执行成片校验',
    muxing: '正在封装 MP4',
    done: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
  }[value] ?? value
}

function artifactLabel(
  value: WebsiteExecutionProjection['artifact'],
): string {
  if (!value) return '等待真实 MP4 Artifact'
  return `${formatBytes(value.sizeBytes)} · ${value.contentHash.slice(0, 12)}`
}

function formatTimestamp(value: string | undefined, timeZone: string): string {
  if (!value) return '等待受控 worker 回传'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone,
  }).format(new Date(value))
}

function formatBytes(value: number): string {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function isWebsiteInspectorTab(value: string): value is WebsiteInspectorTab {
  return WEBSITE_INSPECTOR_TABS.some((tab) => tab.value === value)
}
