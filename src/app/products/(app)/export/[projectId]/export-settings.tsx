'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
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
  onResolutionChange: (preset: ResolutionPreset) => void
}

/** 导出参数与开始导出二次交互面板内容。 */
export function ExportSettings({
  readiness,
  outputUrl,
  exporting,
  disabled,
  onExport,
  onResolutionChange,
}: ExportSettingsProps) {
  const currentPreset = readiness?.resolutionPreset ?? MASTER_RESOLUTION_PRESET
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
      <SettingsRow label="格式" value="MP4 (H.264)" />
      <SettingsSeparator />
      <SettingsRow label="字幕烧录" value="暂不支持（P1）" />
      <div className="flex flex-col gap-3 p-4">
        <Button variant="tinted" icon={Download} disabled={disabled} onClick={onExport}>
          开始导出
        </Button>
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
