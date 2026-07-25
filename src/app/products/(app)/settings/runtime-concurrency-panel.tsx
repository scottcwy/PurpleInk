'use client'

import { Cpu, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import {
  LANE_QUOTA_LIMITS,
  type ReadyModelSettingsController,
} from './model-service-contract'

/**
 * ISSUE-011：渲染队列并发配额面板。
 *
 * 设计约束：
 *   - 「Director 阶段并发」与「渲染并发」必须分开呈现（不合并成单一数字），
 *     否则就重现 ISSUE-004 想消除的「LLM 与渲染共用一个并发」问题。
 *   - 当前真值（DB / env / 代码默认）必须显式标注 source，UI 不能假装是热生效；
 *     保存后必须显示「需要重启 dev 进程才会被 InProcessQueue.lanes 重新读取」。
 *   - 这是**账号级**设置（不带 projectId），UI 上显式标注生效范围。
 *   - 凭据与运行时偏好分区：本面板与「模型服务（凭据）」面板平级且分离,
 *     保存按钮独立，不会让一次保存误触凭据写入。
 */
export interface RuntimeConcurrencyPanelProps {
  controller: ReadyModelSettingsController
}

export function RuntimeConcurrencyPanel({
  controller,
}: RuntimeConcurrencyPanelProps) {
  const view = controller.data.laneQuotas
  const busy = controller.busy === 'laneQuotas'

  return (
    <SettingsPanel
      id="runtime"
      title="运行与导出"
      description="本地渲染并发、输出规格"
      icon={Cpu}
      summary="账号级 · 重启后生效"
    >
      <SettingsRow
        label="Director 阶段并发"
        className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <LaneField
            ariaLabel="Director 阶段并发"
            value={controller.laneQuotasDraft.directorStageConcurrency}
            onChange={(v) =>
              controller.setLaneQuotaField('directorStageConcurrency', v)
            }
            min={LANE_QUOTA_LIMITS.directorStageMin}
            max={LANE_QUOTA_LIMITS.directorStageMax}
          />
          <LaneSourcePill field={view?.directorStage} />
        </div>
      </SettingsRow>
      <SettingsSeparator />
      <SettingsRow
        label="渲染并发"
        className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <LaneField
            ariaLabel="渲染并发"
            value={controller.laneQuotasDraft.renderShotConcurrency}
            onChange={(v) =>
              controller.setLaneQuotaField('renderShotConcurrency', v)
            }
            min={LANE_QUOTA_LIMITS.renderShotMin}
            max={LANE_QUOTA_LIMITS.renderShotMax}
          />
          <LaneSourcePill field={view?.renderShot} />
        </div>
      </SettingsRow>
      <SettingsSeparator />
      <SettingsRow
        label="生效范围"
        value="账号级（写入 workspace_settings）"
      />
      <SettingsSeparator />
      <SettingsRow label="应用方式">
        <span className="flex items-center gap-2 text-[12px] text-ds-text-muted">
          <RefreshCw className="size-3.5" />
          保存后需重启 dev 进程生效
        </span>
      </SettingsRow>
      <SettingsSeparator />
      <SettingsRow label="导出分辨率">
        <span className="text-[13px] text-ds-text-muted">
          按项目在导出页配置
        </span>
      </SettingsRow>
      <SettingsSeparator />
      <SaveRow controller={controller} busy={busy} />
    </SettingsPanel>
  )
}

function LaneField({
  ariaLabel,
  value,
  onChange,
  min,
  max,
}: {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
}) {
  const [touched, setTouched] = useState(false)
  const parsed = Number(value)
  const valid =
    value === '' ||
    (Number.isInteger(parsed) && parsed >= min && parsed <= max)
  const showError = touched && !valid
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-1">
      <TextField
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={`${min}–${max}`}
        className="w-full max-w-[160px]"
      />
      {showError && (
        <span className="text-[11px] text-ds-red">
          请输入 {min}–{max} 之间的整数
        </span>
      )}
    </div>
  )
}

function LaneSourcePill({
  field,
}: {
  field?: { value: number; source: string }
}) {
  if (!field) return null
  if (field.source === 'settings') {
    return <StatusPill variant="rendered" label={`已配置 · ${field.value}`} />
  }
  if (field.source === 'env') {
    return <StatusPill variant="cached" label={`环境变量 · ${field.value}`} />
  }
  return <StatusPill variant="pending" label={`默认 · ${field.value}`} />
}

function SaveRow({
  controller,
  busy,
}: {
  controller: ReadyModelSettingsController
  busy: boolean
}) {
  const director = Number(controller.laneQuotasDraft.directorStageConcurrency)
  const render = Number(controller.laneQuotasDraft.renderShotConcurrency)
  const bothEmpty =
    controller.laneQuotasDraft.directorStageConcurrency === '' &&
    controller.laneQuotasDraft.renderShotConcurrency === ''
  const valid =
    !bothEmpty &&
    Number.isInteger(director) &&
    Number.isInteger(render) &&
    director >= LANE_QUOTA_LIMITS.directorStageMin &&
    director <= LANE_QUOTA_LIMITS.directorStageMax &&
    render >= LANE_QUOTA_LIMITS.renderShotMin &&
    render <= LANE_QUOTA_LIMITS.renderShotMax

  async function save() {
    if (!valid) return
    await controller.submit(
      {
        laneQuotas: {
          directorStageConcurrency: director,
          renderShotConcurrency: render,
        },
      },
      'laneQuotas',
    )
  }

  return (
    <SettingsRow
      label="并发配置"
      className="h-auto min-h-11 flex-wrap gap-2 py-2"
    >
      <span className="text-[12px] text-ds-text-muted">
        留空回退 env / 内置默认
      </span>
      <Button
        size="sm"
        variant="gray"
        onClick={() => void save()}
        disabled={!valid || busy}
      >
        保存
      </Button>
    </SettingsRow>
  )
}