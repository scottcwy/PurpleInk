'use client'

import { AudioLines, Captions, ChevronRight, Download, Film, Music, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { Button } from '@/components/ui/button'
import { ContactSheetThumb } from '@/components/ui/contact-sheet-thumb'
import { IconButton } from '@/components/ui/icon-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsRow } from '@/components/ui/settings-row'
import { TimelineTrack } from '@/components/ui/timeline-track'
import { TopBar } from '@/components/ui/top-bar'
import { Toast } from '@/components/ui/toast'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { DrawerOverlay } from '@/features/navigation/collapsible-panel'
import { TRANSITION_BASE, TRANSITION_INSTANT } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import {
  BP_SECONDARY_PANEL_COLLAPSE,
  EXPORT_SETTINGS_DEFAULT_WIDTH,
  EXPORT_SETTINGS_MAX_WIDTH,
  EXPORT_SETTINGS_MIN_WIDTH,
} from '@/lib/layout/breakpoints'
import {
  loadExportReadiness,
  startProjectExport,
  updateExportResolution,
  type ExportReadiness,
} from './export-api'
import { buildShotClips, fullTrackClip } from './export-view-model'
import {
  EXPORT_RESOLUTION_PRESETS,
  MASTER_RESOLUTION_PRESET,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'

export function ExportWorkspace({
  projectId,
  projectTitle,
  laneKeys,
  rendererNodeId,
}: {
  projectId: string
  projectTitle: string
  laneKeys: string[]
  rendererNodeId?: string
}) {
  const runtime = useExportRuntime(projectId)
  const disabled = !runtime.readiness?.ready || runtime.exporting
  const shotClips = buildShotClips(laneKeys)

  usePublishNavContext({ projectId, rendererNodeId })

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-bg text-label">
        <TopBar
          title="合成与导出"
          actions={
            <Button size="sm" icon={Download} disabled={disabled} onClick={runtime.exportVideo}>
              导出 MP4
            </Button>
          }
        />
        <ExportPreview projectTitle={projectTitle} outputUrl={runtime.outputUrl} />
        <ExportTimeline laneKeys={laneKeys} shotClips={shotClips} />
        <ExportReview
          laneKeys={laneKeys}
          projectId={projectId}
          readiness={runtime.readiness}
          outputUrl={runtime.outputUrl}
          exporting={runtime.exporting}
          error={runtime.error}
          disabled={disabled}
          onExport={runtime.exportVideo}
          onResolutionChange={runtime.updateResolution}
        />
      </main>
  )
}

function useExportRuntime(projectId: string) {
  const [readiness, setReadiness] = useState<ExportReadiness>()
  const [outputUrl, setOutputUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void loadExportReadiness(projectId)
      .then((nextReadiness) => {
        setReadiness(nextReadiness)
        setOutputUrl(nextReadiness.artifactUrl)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '导出状态读取失败')
      })
  }, [projectId])

  async function exportVideo() {
    setExporting(true)
    setError(undefined)
    try {
      setOutputUrl(await startProjectExport(projectId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '终片导出失败')
    } finally {
      setExporting(false)
    }
  }

  async function updateResolution(preset: ResolutionPreset) {
    // 乐观更新：先反映新预设；PATCH 失败时重拉真实状态回滚。
    setReadiness((prev) => (prev ? { ...prev, resolutionPreset: preset } : prev))
    try {
      await updateExportResolution(projectId, preset)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出设置更新失败')
      void loadExportReadiness(projectId).then(setReadiness).catch(() => {})
    }
  }

  return { readiness, outputUrl, error, exporting, exportVideo, updateResolution }
}

function ExportPreview({
  projectTitle,
  outputUrl,
}: {
  projectTitle: string
  outputUrl?: string
}) {
  return (
    <section className="flex h-[257px] flex-col items-center gap-2 p-4">
      <div className="flex h-[200px] w-full max-w-[480px] items-center justify-center overflow-hidden rounded-lg bg-player-bg">
        {outputUrl ? (
          <video src={outputUrl} controls className="h-full w-full" />
        ) : (
          <Film className="h-10 w-10 text-text-inverse" />
        )}
      </div>
      <p className="text-xs text-label-tertiary">{projectTitle} · 成片预览</p>
    </section>
  )
}

function ExportTimeline({
  laneKeys,
  shotClips,
}: {
  laneKeys: string[]
  shotClips: ReturnType<typeof buildShotClips>
}) {
  return (
    <section className="flex flex-col gap-1 px-4 sm:px-6">
      <div className="flex h-5 justify-between border-b border-separator text-[11px] font-mono text-label-tertiary">
        {['00:00', '00:20', '00:40', '01:00', '01:20'].map((time) => (
          <span key={time}>{time}</span>
        ))}
      </div>
      <TimelineTrack icon={Film} label="分镜" clips={shotClips} />
      <TimelineTrack icon={Captions} label="字幕" clips={shotClips} color="bg-stage-direct" />
      <TimelineTrack
        icon={AudioLines}
        label="配音"
        clips={fullTrackClip('配音', laneKeys.length)}
        color="bg-stage-audio"
      />
      <TimelineTrack
        icon={Music}
        label="BGM"
        clips={fullTrackClip('配乐', laneKeys.length)}
        color="bg-stage-assemble"
      />
    </section>
  )
}

function ExportReview(props: {
  laneKeys: string[]
  projectId: string
  readiness?: ExportReadiness
  outputUrl?: string
  exporting: boolean
  error?: string
  disabled: boolean
  onExport: () => void
  onResolutionChange: (preset: ResolutionPreset) => void
}) {
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
          className="absolute left-4 top-4 z-10 shadow-float [&>svg]:rotate-180"
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
        className="flex bg-surface"
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

const RESOLUTION_TIER_LABEL: Record<ResolutionPreset, string> = {
  '1080x1920': '高清',
  '720x1280': '标清',
  '540x960': '流畅',
}

const RESOLUTION_OPTIONS = Object.keys(EXPORT_RESOLUTION_PRESETS).map((key) => ({
  value: key,
  label: RESOLUTION_TIER_LABEL[key as ResolutionPreset],
}))

function ExportSettings({
  readiness,
  outputUrl,
  exporting,
  disabled,
  onExport,
  onResolutionChange,
}: Pick<
  Parameters<typeof ExportReview>[0],
  'readiness' | 'outputUrl' | 'exporting' | 'disabled' | 'onExport' | 'onResolutionChange'
>) {
  const currentPreset = readiness?.resolutionPreset ?? MASTER_RESOLUTION_PRESET
  return (
    <SettingsGroup>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-sc text-label">分辨率</span>
          <span className="text-[13px] font-mono text-label-secondary">
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
            <div className="flex items-center justify-between text-[13px] font-sc">
              <span className="text-label">导出队列</span>
              <span className="text-label-secondary">处理中</span>
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
}: Pick<Parameters<typeof ExportReview>[0], 'laneKeys' | 'readiness' | 'error'>) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Final QA · 抽帧审查</h2>
        <p className="text-xs text-label-tertiary">25% / 60% / 95% 三态联系表</p>
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
          <p className="flex items-center gap-2 text-xs text-label-secondary">
            <TriangleAlert className="h-3.5 w-3.5 text-warning" />未完成分镜
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
