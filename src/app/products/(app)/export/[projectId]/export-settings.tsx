'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import {
  EXPORT_RESOLUTION_PRESETS,
  MASTER_RESOLUTION_PRESET,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'
import { type ExportReadiness } from './export-api'
import { buildResolutionOptions } from './export-view-model'

const RESOLUTION_OPTIONS = buildResolutionOptions()

export interface ExportSettingsProps {
  readiness?: ExportReadiness
  outputUrl?: string
  exporting: boolean
  disabled: boolean
  onExport: () => void
  onDegradedExport: () => void
  onResolutionChange: (preset: ResolutionPreset) => void
}

/** 导出参数与开始导出二次交互面板内容。 */
export function ExportSettings({
  readiness,
  outputUrl,
  exporting,
  disabled,
  onExport,
  onDegradedExport,
  onResolutionChange,
}: ExportSettingsProps) {
  const currentPreset = readiness?.resolutionPreset ?? MASTER_RESOLUTION_PRESET
  const delivery = readiness
    ? readiness.artifactDelivery === 'legacy-silent-v1' && outputUrl
      ? '旧版静音成片'
      : readiness.media.delivery === 'narration-hard-subtitle-v2'
        ? '旁白 + 硬字幕烧录'
        : '旧版静音成片'
    : '等待媒体就绪'
  return (
    <SettingsGroup>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ds-text">分辨率</span>
          <span className="text-xs font-mono text-ds-text-muted">
            {EXPORT_RESOLUTION_PRESETS[currentPreset].label}
          </span>
        </div>
        <SegmentedControl
          options={RESOLUTION_OPTIONS}
          value={currentPreset}
          onChange={(value) => onResolutionChange(value as ResolutionPreset)}
        />
      </div>
      <SettingsSeparator />
      <SettingsRow label="帧率" value="30 fps" />
      <SettingsSeparator />
      <SettingsRow label="格式" value="MP4 (H.264 + AAC)" />
      <SettingsSeparator />
      <SettingsRow label="字幕交付" value={delivery} />
      {readiness?.degradedExport && (
        <>
          <SettingsSeparator />
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <StatusPill
              variant="stale"
              label={`降级导出 · ${readiness.degradedExport.placeholderLanes.length} 镜占位`}
            />
            <span className="truncate text-xs text-ds-text-muted">
              {readiness.degradedExport.placeholderLanes.join('、')}
            </span>
          </div>
        </>
      )}
      <div className="flex flex-col gap-3 p-4">
        <Button icon={Download} disabled={disabled} onClick={onExport}>
          开始导出
        </Button>
        {readiness && !readiness.ready && readiness.degradedReady && (
          <div className="flex flex-col gap-1.5">
            <Button
              variant="destructive"
              disabled={exporting}
              onClick={onDegradedExport}
            >
              {`降级导出（${degradedLaneCount(readiness)} 个镜头将以占位呈现）`}
            </Button>
            <p className="text-[11px] leading-relaxed text-ds-text-muted">
              失败或已跳过的分镜将以黑场占位、无字幕（旁白保留）。已跳过的环节将导出为降级版本；
              修复后重新导出可自动升级为完整版。
              {readiness.placeholderCandidateLanes.length > 0 &&
                `待占位：${readiness.placeholderCandidateLanes.join('、')}`}
            </p>
          </div>
        )}
        {exporting ? (
          <div className="flex w-full flex-col gap-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ds-text">导出队列</span>
              <span className="text-ds-text-muted">处理中</span>
            </div>
            <Skeleton className="h-1.5 w-full rounded-full bg-ds-blue-soft" />
          </div>
        ) : (
          <ProgressBar value={outputUrl ? 100 : 0} label="导出队列" className="w-full" />
        )}
      </div>
    </SettingsGroup>
  )
}

/** 待占位镜头数：优先用候选 lane，回退到阻塞项中的渲染缺失数。 */
function degradedLaneCount(readiness: ExportReadiness): number {
  if (readiness.placeholderCandidateLanes.length > 0) {
    return readiness.placeholderCandidateLanes.length
  }
  return new Set(
    readiness.blockingIssues
      .filter((issue) => issue.kind === 'render' && issue.laneKey !== null)
      .map((issue) => issue.laneKey)
  ).size
}
