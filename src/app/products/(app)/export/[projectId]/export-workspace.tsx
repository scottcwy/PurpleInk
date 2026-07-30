'use client'

import { AudioLines, Captions, Download, Film, Music, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { Button } from '@/components/ui/button'
import { MediaViewport } from '@/components/ui/media-viewport'
import { Popover } from '@/components/ui/popover'
import { TimelineTrack } from '@/components/ui/timeline-track'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ExportDeliveryCheck } from './export-delivery-check'
import { ExportSettings } from './export-settings'
import { buildLaneSpans } from './export-view-model'
import type { ExportReadiness } from './export-readiness-contract'
import { useExportRuntime } from './use-export-runtime'

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
  const shotClips = buildLaneSpans(laneKeys)
  const [settingsOpen, setSettingsOpen] = useState(false)

  usePublishNavContext({ projectId, rendererNodeId })

  async function handleExport() {
    const url = await runtime.exportVideo()
    if (url) setSettingsOpen(false)
  }

  async function handleDegradedExport() {
    const url = await runtime.exportDegraded()
    if (url) setSettingsOpen(false)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto text-ds-text">
      <TopBar
        title="合成与导出"
        actions={
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            dismissible={!runtime.exporting}
            trigger={
              <Button
                size="sm"
                icon={Download}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                导出
              </Button>
            }
          >
            <ExportSettings
              readiness={runtime.readiness}
              outputUrl={runtime.outputUrl}
              exporting={runtime.exporting}
              disabled={disabled}
              onExport={handleExport}
              onDegradedExport={handleDegradedExport}
              onResolutionChange={runtime.updateResolution}
            />
          </Popover>
        }
      />
      <ExportPreview
        projectTitle={projectTitle}
        outputUrl={runtime.outputUrl}
        loading={runtime.exporting && !runtime.outputUrl}
      />
      <ExportTimeline
        laneKeys={laneKeys}
        shotClips={shotClips}
        readiness={runtime.readiness}
      />
      <ExportDeliveryCheck
        projectId={projectId}
        laneKeys={laneKeys}
        readiness={runtime.readiness}
        error={runtime.error}
      />
    </main>
  )
}

function ExportPreview({
  projectTitle,
  outputUrl,
  loading,
}: {
  projectTitle: string
  outputUrl?: string
  loading: boolean
}) {
  return (
    <section className="flex flex-col items-center gap-2 p-4">
      <MediaViewport className="max-w-[640px]" loading={loading}>
        {outputUrl ? (
          <video src={outputUrl} controls className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <Film className="h-10 w-10 text-text-inverse" />
        )}
      </MediaViewport>
      <p className="text-xs text-ds-text-muted">{projectTitle} · 成片预览</p>
      {outputUrl && <ArtifactChip icon={Download} filename="final.mp4" href={outputUrl} />}
    </section>
  )
}

function ExportTimeline({
  laneKeys,
  shotClips,
  readiness,
}: {
  laneKeys: string[]
  shotClips: ReturnType<typeof buildLaneSpans>
  readiness?: ExportReadiness
}) {
  const narrationLanes = readyMediaLanes(laneKeys, readiness, 'narration')
  // 关闭字幕交付时服务端不再测量就绪数（投影为 null）。此处必须显示「本次不入片」
  // 而不是把它塌成 0 —— 「字幕 0/5」会被读成「字幕一个都没好」。
  const subtitlesOff = readiness?.subtitles === 'off'
  const subtitleLanes = subtitlesOff
    ? []
    : readyMediaLanes(laneKeys, readiness, 'subtitle')
  return (
    <section className="flex flex-col gap-1 px-4 sm:px-6">
      <TimelineTrack
        icon={Film}
        label="分镜"
        meta={`${laneKeys.length}`}
        clips={shotClips}
      />
      <TimelineTrack
        icon={Captions}
        label="字幕"
        {...(subtitlesOff
          ? {
              muted: true,
              emptyLabel: '本次不入片',
              title: '导出设置已选择不烧录字幕',
            }
          : {
              meta: `${subtitleLanes.length}/${laneKeys.length}`,
              title: `字幕就绪 ${subtitleLanes.length} / ${laneKeys.length}`,
            })}
        clips={buildLaneSpans(laneKeys, subtitleLanes)}
      />
      <TimelineTrack
        icon={AudioLines}
        label="配音"
        meta={`${narrationLanes.length}/${laneKeys.length}`}
        title={`旁白就绪 ${narrationLanes.length} / ${laneKeys.length}`}
        clips={buildLaneSpans(laneKeys, narrationLanes)}
      />
      <TimelineTrack
        icon={Music}
        label="音乐"
        muted
        emptyLabel="接口预留 · 未实现"
        clips={[]}
      />
      <TimelineTrack
        icon={Volume2}
        label="音效"
        muted
        emptyLabel="接口预留 · 未实现"
        clips={[]}
      />
    </section>
  )
}

function readyMediaLanes(
  laneKeys: string[],
  readiness: ExportReadiness | undefined,
  kind: 'narration' | 'subtitle'
): string[] {
  if (!readiness) return []
  const blocked = new Set(
    readiness.blockingIssues
      .filter((issue) => issue.kind === kind && issue.laneKey)
      .map((issue) => issue.laneKey)
  )
  const count =
    kind === 'narration'
      ? readiness.media.narrationReadyCount
      : readiness.media.subtitleReadyCount
  // count 为 null 表示服务端未测量（本次交付不含字幕），调用方已单独处理。
  if (count === null) return []
  return [...laneKeys]
    .sort((left, right) => left.localeCompare(right))
    .filter((laneKey) => !blocked.has(laneKey))
    .slice(0, count)
}
