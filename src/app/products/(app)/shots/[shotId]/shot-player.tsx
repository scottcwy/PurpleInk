'use client'

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  activeThumbIndex,
  fetchThumbnails,
  formatTimecode,
  stepFrame,
  type ShotThumbnail,
} from './shot-api'

/** 缩略图轨道格数，与服务端等距取帧数保持一致。 */
const THUMBNAIL_COUNT = 8

export function ShotPlayer({
  outputUrl,
  previewUrl,
  error,
  projectId,
  nodeId,
  fps,
}: {
  outputUrl?: string
  previewUrl?: string
  error?: string
  projectId: string
  nodeId: string
  fps?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [thumbnails, setThumbnails] = useState<ShotThumbnail[]>()
  const [thumbsError, setThumbsError] = useState(false)

  const hasVideo = Boolean(outputUrl)
  const canStep = hasVideo && fps !== undefined

  useEffect(() => {
    if (!outputUrl) return
    let active = true
    void fetchThumbnails(projectId, nodeId)
      .then((items) => {
        if (!active) return
        setThumbnails(items)
        setThumbsError(false)
      })
      .catch(() => {
        if (active) setThumbsError(true)
      })
    return () => {
      active = false
    }
  }, [outputUrl, projectId, nodeId])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  function stepBy(deltaFrames: number) {
    const video = videoRef.current
    if (!video || fps === undefined) return
    video.currentTime = stepFrame(video.currentTime, deltaFrames, fps, duration)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex h-[480px] items-center justify-center overflow-hidden rounded-lg bg-player-bg">
        {outputUrl ? (
          <video
            ref={videoRef}
            src={outputUrl}
            className="h-full w-full"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration
              setDuration(Number.isFinite(value) ? value : 0)
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : previewUrl ? (
          <iframe
            title="确定性分镜预览"
            src={previewUrl}
            sandbox="allow-scripts"
            className="h-full w-full border-0"
          />
        ) : (
          <Play className="h-10 w-10 text-text-inverse" />
        )}
      </div>
      {hasVideo && (
        <>
          <div className="flex h-12 items-center gap-3">
            <IconButton
              icon={SkipBack}
              aria-label="上一帧"
              onClick={() => stepBy(-1)}
              disabled={!canStep}
            />
            <IconButton
              icon={isPlaying ? Pause : Play}
              aria-label={isPlaying ? '暂停' : '播放'}
              onClick={togglePlay}
            />
            <IconButton
              icon={SkipForward}
              aria-label="下一帧"
              onClick={() => stepBy(1)}
              disabled={!canStep}
            />
            <span className="text-xs font-mono text-ds-text-muted">
              {formatTimecode(currentTime)} / {formatTimecode(duration)}
            </span>
            <ProgressBar
              value={duration > 0 ? (currentTime / duration) * 100 : 0}
              className="flex-1"
            />
          </div>
          <ThumbnailTrack
            error={thumbsError}
            thumbnails={thumbnails}
            activeIndex={activeThumbIndex(
              currentTime,
              duration,
              thumbnails?.length ?? THUMBNAIL_COUNT,
            )}
          />
        </>
      )}
      {error && <Toast variant="error" title="失败" body={error} />}
    </div>
  )
}

function ThumbnailTrack({
  error,
  thumbnails,
  activeIndex,
}: {
  error: boolean
  thumbnails?: ShotThumbnail[]
  activeIndex: number
}) {
  if (error) {
    return (
      <p className="flex h-18 items-center justify-center rounded-md bg-ds-surface-muted text-xs text-ds-text-muted">
        缩略图生成失败
      </p>
    )
  }
  if (!thumbnails) {
    return (
      <div className="grid h-18 grid-cols-8 gap-1">
        {Array.from({ length: THUMBNAIL_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-full w-full" />
        ))}
      </div>
    )
  }
  return (
    <div className="grid h-18 grid-cols-8 gap-1">
      {thumbnails.map((thumb, index) => (
        // eslint-disable-next-line @next/next/no-img-element -- 动态 API 帧图，本地优先无需 next/image 优化
        <img
          key={thumb.fraction}
          src={thumb.url}
          alt={`第 ${index + 1} 帧`}
          className={cn(
            'h-full w-full rounded-sm object-cover',
            index === activeIndex && 'border border-accent',
          )}
        />
      ))}
    </div>
  )
}
