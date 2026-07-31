'use client'

import Link from 'next/link'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import {
  productCanvasHref,
  productShotHref,
} from '@/features/navigation/products-routes'
import { ShotContract, ShotCode } from './shot-detail-panels'
import { ShotPanelChrome, useShotPanelState } from './shot-panels'
import { ShotPlayer } from './shot-player'
import { ShotRevisionDialog } from './shot-revision-dialog'
import { useShotRuntime } from './use-shot-runtime'

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
    <main className="flex min-h-0 min-w-0 flex-1 flex-col text-ds-text">
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <Link
              href={productCanvasHref(projectId)}
              aria-label="返回画布"
            >
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
            {runtime.canRevise && (
              <ShotRevisionDialog
                disabled={runtime.rendering}
                onConfirm={runtime.revise}
              />
            )}
            <Button
              variant="destructive"
              size="sm"
              icon={RefreshCw}
              onClick={runtime.render}
              disabled={runtime.rendering}
            >
              重渲此镜
            </Button>
            {runtime.outputUrl && (
              <a href={runtime.outputUrl} download>
                <Button size="sm" icon={Download}>
                  导出 MP4
                </Button>
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
    <Link href={productShotHref(nodeId, projectId)}>
      <Button variant="gray" size="sm">{label}</Button>
    </Link>
  )
}
