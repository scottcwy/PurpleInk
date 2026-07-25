'use client'

import { AudioLines, Captions, Download, Film, Music } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaViewport } from '@/components/ui/media-viewport'
import { TimelineTrack } from '@/components/ui/timeline-track'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ExportReview } from './export-review'
import { buildShotClips, fullTrackClip } from './export-view-model'
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
  const shotClips = buildShotClips(laneKeys)

  usePublishNavContext({ projectId, rendererNodeId })

  return (
    <main className="min-h-0 flex-1 overflow-y-auto text-ds-text">
      <TopBar
        title="合成与导出"
        actions={
          <Button size="sm" icon={Download} disabled={disabled} onClick={runtime.exportVideo}>
            导出 MP4
          </Button>
        }
      />
      <ExportPreview
        projectTitle={projectTitle}
        outputUrl={runtime.outputUrl}
        loading={runtime.exporting && !runtime.outputUrl}
      />
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
      <div className="flex h-5 justify-between border-b border-ds-border text-[11px] font-mono text-ds-text-muted">
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
