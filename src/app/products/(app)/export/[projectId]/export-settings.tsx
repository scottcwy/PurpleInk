'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { Toggle } from '@/components/ui/toggle'
import {
  EXPORT_RESOLUTION_PRESETS,
  MASTER_RESOLUTION_PRESET,
  type ResolutionPreset,
  type SubtitleDeliveryMode,
} from '@/features/canvas/export-settings'
import { type ExportReadiness } from './export-readiness-contract'
import {
  buildResolutionOptions,
  formatTimelineDuration,
} from './export-view-model'

const RESOLUTION_OPTIONS = buildResolutionOptions()

export interface ExportSettingsProps {
  readiness?: ExportReadiness
  outputUrl?: string
  exporting: boolean
  disabled: boolean
  onExport: () => void
  onDegradedExport: () => void
  onResolutionChange: (preset: ResolutionPreset) => void
  onSubtitlesChange: (mode: SubtitleDeliveryMode) => void
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
  onSubtitlesChange,
}: ExportSettingsProps) {
  const currentPreset = readiness?.resolutionPreset ?? MASTER_RESOLUTION_PRESET
  const subtitles = readiness?.subtitles ?? 'burn-in'
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
      <SettingsRow
        label="帧率"
        value={readiness?.timeline ? `${readiness.timeline.fps} fps` : '等待时间合同'}
        chevron={false}
      />
      <SettingsSeparator />
      <SettingsRow
        label="真实时长"
        value={formatTimelineDuration(readiness?.timeline ?? null)}
        chevron={false}
      />
      <SettingsSeparator />
      <SettingsRow label="格式" value="MP4 (H.264 + AAC)" chevron={false} />
      <SettingsSeparator />
      <SettingsRow
        label="本次导出字幕"
        value={subtitles === 'burn-in' ? '含字幕 · 硬字幕烧录' : '不含字幕'}
        chevron={false}
      >
        <Toggle
          checked={subtitles === 'burn-in'}
          disabled={!readiness || exporting}
          aria-label="本次导出包含字幕"
          onCheckedChange={(checked) =>
            onSubtitlesChange(checked ? 'burn-in' : 'off')
          }
        />
      </SettingsRow>
      <SettingsSeparator />
      <SettingsRow
        label="最近成片字幕"
        value={artifactSubtitleLabel(readiness, outputUrl)}
        chevron={false}
      />
      {readiness?.degradedExport && (
        <>
          <SettingsSeparator />
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <StatusPill
              variant="stale"
              label={degradedSummary(
                readiness.degradedExport.placeholderLanes,
                readiness.degradedExport.waivedQaLanes
              )}
            />
            <span className="truncate text-xs text-ds-text-muted">
              {degradedLaneDetails(readiness.degradedExport)}
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
              {degradedActionLabel(readiness)}
            </Button>
            <p className="text-[11px] leading-relaxed text-ds-text-muted">
              占位镜头将以黑场、无字幕呈现（旁白保留）；QA 豁免镜头保持现有画面，但明确标记为未验收。
              本操作需要人工确认，修复并重新执行后可恢复为完整版。
              {readiness.placeholderCandidateLanes.length > 0 &&
                `待占位：${readiness.placeholderCandidateLanes.join('、')}`}
              {readiness.waivedQaLanes.length > 0 &&
                ` 未验收：${readiness.waivedQaLanes.join('、')}`}
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

function artifactSubtitleLabel(
  readiness: ExportReadiness | undefined,
  outputUrl: string | undefined
): string {
  if (!readiness || !outputUrl || readiness.artifactDelivery === 'none') {
    return '尚无成片'
  }
  if (readiness.artifactDelivery === 'narration-hard-subtitle-v2') {
    return '已烧录字幕'
  }
  if (readiness.artifactDelivery === 'narration-no-subtitle-v3') {
    return '不含字幕'
  }
  return '旧版静音成片'
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

function degradedActionLabel(readiness: ExportReadiness): string {
  return `降级导出（${degradedLaneCount(readiness)} 镜占位 · ${readiness.waivedQaLanes.length} 镜未验收）`
}

function degradedSummary(
  placeholderLanes: string[],
  waivedQaLanes: string[]
): string {
  return `已完成 · 降级交付 · ${placeholderLanes.length} 镜占位 · ${waivedQaLanes.length} 镜未验收`
}

function degradedLaneDetails(
  degraded: NonNullable<ExportReadiness['degradedExport']>
): string {
  const details = [
    degraded.placeholderLanes.length > 0
      ? `占位：${degraded.placeholderLanes.join('、')}`
      : '',
    degraded.waivedQaLanes.length > 0
      ? `未验收：${degraded.waivedQaLanes.join('、')}`
      : '',
  ].filter(Boolean)
  return details.join('；')
}
