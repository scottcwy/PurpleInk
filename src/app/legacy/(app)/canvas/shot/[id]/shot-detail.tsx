'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  FileCode,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TopBar } from '@/components/ui/top-bar'
import { Toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ShotPanelChrome, useShotPanelState } from './shot-panels'
import {
  activeThumbIndex,
  fetchThumbnails,
  formatTimecode,
  renderShotAndWait,
  stepFrame,
  type ShotThumbnail,
} from './shot-api'

/** ShotCode 在无代码时的占位文案，也用于判断是否需走"生成"入口（§6）。 */
const NO_CODE = '分镜代码尚未生成'
/** 缩略图轨道格数，与服务端 GET /api/render/thumbnails 的等距取帧数保持一致。 */
const THUMBNAIL_COUNT = 8

export function ShotDetail({
  projectId,
  projectTitle,
  nodeId,
  laneKey,
  sourceText,
  previousNodeId,
  nextNodeId,
  previewUrl,
  initialOutputUrl,
  resolution,
  fps,
  compositionMode,
}: {
  projectId: string
  projectTitle: string
  nodeId: string
  laneKey: string
  sourceText: string
  previousNodeId?: string
  nextNodeId?: string
  previewUrl?: string
  initialOutputUrl?: string
  resolution?: { width: number; height: number }
  fps?: number
  compositionMode?: string
}) {
  const runtime = useShotRuntime(projectId, nodeId, previewUrl, initialOutputUrl)
  const panels = useShotPanelState()

  usePublishNavContext({ projectId, rendererNodeId: nodeId })

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          title={
            <span className="flex items-center gap-2">
              <Link href={`/legacy/canvas?projectId=${projectId}`} aria-label="返回画布">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              {laneKey} · {projectTitle}
              <StatusPill
                variant={
                  runtime.outputUrl
                    ? 'rendered'
                    : runtime.rendering
                      ? 'generating'
                      : 'pending'
                }
              />
            </span>
          }
          actions={
            <>
              <ShotLink label="上一镜" nodeId={previousNodeId} projectId={projectId} />
              <ShotLink label="下一镜" nodeId={nextNodeId} projectId={projectId} />
              <Button
                variant="tinted"
                size="sm"
                icon={RefreshCw}
                onClick={runtime.render}
                disabled={runtime.rendering}
              >
                重渲此镜
              </Button>
              {runtime.outputUrl && (
                <a href={runtime.outputUrl} download>
                  <Button size="sm" icon={Download}>导出 MP4</Button>
                </a>
              )}
            </>
          }
        />
        <ShotPanelChrome
          panels={panels}
          player={
            <ShotPlayer
              outputUrl={runtime.outputUrl}
              previewUrl={previewUrl}
              error={runtime.error}
              projectId={projectId}
              nodeId={nodeId}
              fps={fps}
            />
          }
          codeContent={
            <ShotCode
              sourceCode={runtime.sourceCode}
              codeLoading={runtime.codeLoading}
              codeError={runtime.codeError}
              rendering={runtime.rendering}
              onRender={runtime.render}
            />
          }
          contractContent={
            <ShotContract
              laneKey={laneKey}
              sourceText={sourceText}
              compositionMode={compositionMode}
              resolution={resolution}
              deterministic={Boolean(runtime.outputUrl)}
            />
          }
        />
      </main>
  )
}

/**
 * 分镜页运行时状态。§1：outputUrl 以服务端查到的 render-mp4（initialOutputUrl）初始化，
 * 刷新/首次进入即见历史视频；§6：render() 成功后 router.refresh() 让服务端组件回填
 * 新的代码/视频/合同字段（"生成分镜代码"与"重渲此镜"共用同一渲染入口）。
 */
function useShotRuntime(
  projectId: string,
  nodeId: string,
  previewUrl?: string,
  initialOutputUrl?: string,
) {
  const router = useRouter()
  const [rendering, setRendering] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | undefined>(initialOutputUrl)
  const [sourceCode, setSourceCode] = useState(previewUrl ? '' : NO_CODE)
  const [codeLoading, setCodeLoading] = useState(Boolean(previewUrl))
  const [codeError, setCodeError] = useState(false)
  const [error, setError] = useState<string>()

  // 读取分镜代码（director-fabricate HTML）。setState 全部放在异步回调里，
  // 避免在 effect 体内同步 setState 触发级联渲染。
  useEffect(() => {
    if (!previewUrl) return
    let active = true
    void fetch(previewUrl)
      .then((response) => {
        if (!response.ok) throw new Error('分镜代码读取失败')
        return response.text()
      })
      .then((text) => {
        if (!active) return
        setSourceCode(text)
        setCodeError(false)
      })
      .catch(() => {
        if (!active) return
        setCodeError(true)
        setSourceCode('分镜代码读取失败')
      })
      .finally(() => {
        if (active) setCodeLoading(false)
      })
    return () => {
      active = false
    }
  }, [previewUrl])

  async function render() {
    setRendering(true)
    setError(undefined)
    try {
      const result = await renderShotAndWait(projectId, nodeId)
      if (result.status === 'failed') {
        setError(result.error ?? '单镜渲染失败')
      } else {
        if (result.artifactUrl) setOutputUrl(result.artifactUrl)
        // 服务端组件重查，回填新的 previewUrl（代码）/ render-mp4（视频）/ 合同字段。
        router.refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '单镜渲染失败')
    } finally {
      setRendering(false)
    }
  }
  return { rendering, outputUrl, sourceCode, codeLoading, codeError, error, render }
}

function ShotLink({
  label,
  nodeId,
  projectId,
}: {
  label: string
  nodeId?: string
  projectId: string
}) {
  if (!nodeId) return <Button variant="gray" size="sm" disabled>{label}</Button>
  return (
    <Link href={`/legacy/canvas/shot/${nodeId}?projectId=${projectId}`}>
      <Button variant="gray" size="sm">{label}</Button>
    </Link>
  )
}

/**
 * §2/§3：受控 `<video>` 播放器。仅在存在真实 render-mp4（outputUrl）时渲染播放控件
 * 与缩略图轨道；预览态（iframe）或空态没有播放进度概念，整条 transport 不渲染。
 */
function ShotPlayer({
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

  // §3：有真实视频时才按需拉取缩略图；截帧成本由服务端 issue-04 的 sha256 缓存兜底。
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

  // 逐帧步进依赖真实 fps（来自 renderSpec）；缺 fps 时按钮已禁用（canStep）。
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
            <span className="text-xs font-mono text-label-secondary">
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
            activeIndex={activeThumbIndex(currentTime, duration, thumbnails?.length ?? THUMBNAIL_COUNT)}
          />
        </>
      )}
      {error && <Toast variant="error" title="失败" body={error} />}
    </div>
  )
}

/**
 * §3：真实帧图轨道。未就绪展示 Skeleton、失败给诚实提示，都不回退成纯色占位块；
 * 高亮格由播放进度实时派生（activeIndex），替换旧的写死高亮。
 */
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
      <p className="flex h-18 items-center justify-center rounded-sm bg-fill text-xs text-label-tertiary">
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

/**
 * §4/§6：代码面板。同步状态徽章由真实状态派生（见 codeSyncLabel）；无代码时底部按钮
 * 变为"生成分镜代码"，与"重渲此镜"共用 onRender（走 /api/render，内部先 fabricate 再渲染）。
 */
function ShotCode({
  sourceCode,
  codeLoading,
  codeError,
  rendering,
  onRender,
}: {
  sourceCode: string
  codeLoading: boolean
  codeError: boolean
  rendering: boolean
  onRender: () => void
}) {
  const hasCode = sourceCode !== NO_CODE
  const sync = codeSyncLabel({ rendering, codeLoading, codeError, hasCode })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <FileCode className="h-4 w-4 text-accent" />分镜画布代码
        </span>
        <span className={cn('text-[11px]', sync.tone)}>{sync.label}</span>
      </div>
      {codeLoading ? (
        <div className="min-h-0 flex-1 space-y-2 rounded-md bg-bg-secondary p-3">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-3" style={{ width: `${92 - index * 9}%` }} />
          ))}
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-bg-secondary p-3 text-[11px] leading-relaxed text-label-secondary">
          {sourceCode}
        </pre>
      )}
      <Button variant="tinted" icon={RefreshCw} onClick={onRender} disabled={rendering}>
        {hasCode ? '重渲此镜' : '生成分镜代码'}
      </Button>
    </div>
  )
}

/** 代码同步状态诚实映射：渲染中 / 加载中 / 读取失败 / 已同步 / 待生成。 */
function codeSyncLabel({
  rendering,
  codeLoading,
  codeError,
  hasCode,
}: {
  rendering: boolean
  codeLoading: boolean
  codeError: boolean
  hasCode: boolean
}): { label: string; tone: string } {
  if (rendering) return { label: '渲染中', tone: 'text-label-tertiary' }
  if (codeLoading) return { label: '加载中', tone: 'text-label-tertiary' }
  if (codeError) return { label: '读取失败', tone: 'text-danger' }
  if (hasCode) return { label: '已同步', tone: 'text-success' }
  return { label: '待生成', tone: 'text-label-tertiary' }
}

/**
 * §5：分镜合同。构图模式/分辨率来自真实数据（缺失显式"待生成"）；确定性声明按是否存在
 * 成功的 render-mp4 展示"通过/未验证"（最简方案，不改 renderer.ts 持久化）。
 */
function ShotContract({
  laneKey,
  sourceText,
  compositionMode,
  resolution,
  deterministic,
}: {
  laneKey: string
  sourceText: string
  compositionMode?: string
  resolution?: { width: number; height: number }
  deterministic: boolean
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <h2 className="text-[13px] font-semibold text-label-secondary">分镜合同</h2>
      <SettingsGroup>
        <SettingsRow label="分镜编号" value={laneKey} />
        <SettingsSeparator />
        <SettingsRow label="构图模式" value={compositionMode ?? '待生成'} />
        <SettingsSeparator />
        <SettingsRow
          label="分辨率"
          value={resolution ? `${resolution.width}×${resolution.height}` : '待生成'}
        />
      </SettingsGroup>
      <h2 className="text-[13px] font-semibold text-label-secondary">字幕</h2>
      <div className="rounded-sm bg-fill p-2">
        <p className="mb-1 text-xs font-mono text-accent">00:00–结束</p>
        <p className="text-[13px]">{sourceText}</p>
      </div>
      <p className="flex items-center gap-2 text-xs text-label-secondary">
        <ShieldCheck
          className={cn('h-3.5 w-3.5', deterministic ? 'text-success' : 'text-label-tertiary')}
        />
        {deterministic ? '无 rAF / 无墙钟 · 通过' : '无 rAF / 无墙钟 · 未验证'}
      </p>
    </aside>
  )
}
