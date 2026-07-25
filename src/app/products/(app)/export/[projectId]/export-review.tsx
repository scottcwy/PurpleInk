'use client'

import { ChevronRight, Download, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { Button } from '@/components/ui/button'
import { ContactSheetThumb } from '@/components/ui/contact-sheet-thumb'
import { IconButton } from '@/components/ui/icon-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import {
  EXPORT_RESOLUTION_PRESETS,
  MASTER_RESOLUTION_PRESET,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'
import { DrawerOverlay } from '@/features/navigation/collapsible-panel'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import {
  BP_SECONDARY_PANEL_COLLAPSE,
  EXPORT_SETTINGS_DEFAULT_WIDTH,
  EXPORT_SETTINGS_MAX_WIDTH,
  EXPORT_SETTINGS_MIN_WIDTH,
} from '@/lib/layout/breakpoints'
import { TRANSITION_BASE, TRANSITION_INSTANT } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'
import { type ExportReadiness } from './export-api'
import { buildResolutionOptions } from './export-view-model'

interface ExportReviewProps {
  laneKeys: string[]
  projectId: string
  readiness?: ExportReadiness
  outputUrl?: string
  exporting: boolean
  error?: string
  disabled: boolean
  onExport: () => void
  onResolutionChange: (preset: ResolutionPreset) => void
}

export function ExportReview(props: ExportReviewProps) {
  const autoCollapse = useMediaQuery(`(max-width: ${BP_SECONDARY_PANEL_COLLAPSE - 1}px)`)
  const [manualCollapsed, setManualCollapsed] = usePersistentToggle(
    'cvc:export-settings-collapsed',
    false,
  )
  const { width, isDragging, handlePointerDown, setWidth } = useResizablePanel({
    storageKey: 'cvc:export-settings-width',
    defaultWidth: EXPORT_SETTINGS_DEFAULT_WIDTH,
    min: EXPORT_SETTINGS_MIN_WIDTH,
    max: EXPORT_SETTINGS_MAX_WIDTH,
  })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const collapsed = autoCollapse || manualCollapsed
  const drawerOpen = autoCollapse && overlayOpen

  return (
    <section className="relative flex gap-4 p-4">
      {!autoCollapse && (
        <motion.div
          className="relative shrink-0 overflow-hidden"
          initial={false}
          animate={{ width: manualCollapsed ? 0 : width }}
          transition={manualCollapsed || !isDragging ? TRANSITION_BASE : TRANSITION_INSTANT}
        >
          <div className="mb-2 flex justify-end">
            <IconButton
              icon={ChevronRight}
              aria-label="收起导出设置"
              className="[&>svg]:rotate-180"
              onClick={() => setManualCollapsed(true)}
            />
          </div>
          <ExportSettings {...props} />
          {!manualCollapsed && (
            <ResizeHandle
              className="absolute inset-y-0 right-0"
              isDragging={isDragging}
              onPointerDown={handlePointerDown}
              onKeyAdjust={(delta) => setWidth(width + delta)}
              aria-label="调节导出设置宽度"
            />
          )}
        </motion.div>
      )}
      {collapsed && !drawerOpen && (
        <IconButton
          icon={ChevronRight}
          aria-label="展开导出设置"
          className="absolute left-4 top-4 z-10 shadow-[var(--ds-shadow)] [&>svg]:rotate-180"
          onClick={() => {
            if (autoCollapse) setOverlayOpen(true)
            else setManualCollapsed(false)
          }}
        />
      )}
      <div className={cn('min-w-0 flex-1', collapsed && !drawerOpen && 'pl-12')}>
        <ExportQa {...props} />
      </div>
      <DrawerOverlay
        open={drawerOpen}
        onDismiss={() => setOverlayOpen(false)}
        side="left"
        scrimLabel="关闭导出设置遮罩"
        className="flex bg-ds-surface text-ds-text"
        style={{ width }}
      >
        <div className="min-w-0 flex-1 overflow-auto p-4">
          <div className="mb-2 flex justify-end">
            <IconButton
              icon={ChevronRight}
              aria-label="关闭导出设置"
              onClick={() => setOverlayOpen(false)}
            />
          </div>
          <ExportSettings {...props} />
        </div>
        <ResizeHandle
          isDragging={isDragging}
          onPointerDown={handlePointerDown}
          onKeyAdjust={(delta) => setWidth(width + delta)}
          aria-label="调节导出设置宽度"
        />
      </DrawerOverlay>
    </section>
  )
}

const RESOLUTION_OPTIONS = buildResolutionOptions()

function ExportSettings({
  readiness,
  outputUrl,
  exporting,
  disabled,
  onExport,
  onResolutionChange,
}: Pick<
  ExportReviewProps,
  'readiness' | 'outputUrl' | 'exporting' | 'disabled' | 'onExport' | 'onResolutionChange'
>) {
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
        <Button icon={Download} disabled={disabled} onClick={onExport}>
          开始导出
        </Button>
        {exporting ? (
          <div className="flex w-full flex-col gap-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ds-text">导出队列</span>
              <span className="text-ds-text-muted">处理中</span>
            </div>
            <Skeleton className="h-1 w-full" />
          </div>
        ) : (
          <ProgressBar value={outputUrl ? 100 : 0} label="导出队列" className="w-full" />
        )}
        {outputUrl && <ArtifactChip icon={Download} filename="final.mp4" href={outputUrl} />}
      </div>
    </SettingsGroup>
  )
}

function ExportQa({
  laneKeys,
  readiness,
  error,
}: Pick<ExportReviewProps, 'laneKeys' | 'readiness' | 'error'>) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Final QA · 抽帧审查</h2>
        <p className="text-xs text-ds-text-muted">25% / 60% / 95% 三态联系表</p>
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {laneKeys.map((laneKey) => (
          <ContactSheetThumb
            key={laneKey}
            label={laneKey}
            checked={readiness?.shotQa[laneKey] ?? undefined}
          />
        ))}
      </div>
      {!readiness && !error && (
        <div className="flex items-center gap-2">
          <Skeleton circle className="h-3.5 w-3.5" />
          <Skeleton className="h-3 w-40" />
        </div>
      )}
      {!readiness?.ready && readiness && (
        <>
          <p className="flex items-center gap-2 text-xs text-ds-text-muted">
            <TriangleAlert className="size-3.5 text-ds-amber" />未完成分镜
          </p>
          <div className="flex max-h-20 flex-wrap gap-2 overflow-auto">
            {readiness.incompleteNodeIds.map((id) => (
              <ArtifactChip key={id} filename={id} />
            ))}
          </div>
        </>
      )}
      {error && <Toast variant="error" title="失败" body={error} />}
    </div>
  )
}
