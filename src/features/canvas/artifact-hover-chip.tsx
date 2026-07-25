'use client'

import { FileCode } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { HoverPreview } from '@/components/ui/hover-preview'
import { Skeleton } from '@/components/ui/skeleton'
import {
  artifactPreviewMode,
  type ArtifactPreviewMode,
} from '@/features/artifacts/preview-mode'

const TEXT_PREVIEW_LIMIT = 256 * 1024

const textCache = new Map<string, string>()

export interface ArtifactHoverChipProps {
  artifactId: string
  kind: string
  filename: string
  projectId: string
}

/**
 * Canvas inspector artifact chip with intentional hover preview.
 * Click still opens the artifact bytes in a new tab.
 */
export function ArtifactHoverChip({
  artifactId,
  kind,
  filename,
  projectId,
}: ArtifactHoverChipProps) {
  const href = `/api/artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`
  const mode = artifactPreviewMode(kind)

  return (
    <HoverPreview
      label={`${filename} 预览`}
      trigger={
        <ArtifactChip icon={FileCode} filename={filename} href={href} />
      }
    >
      <ArtifactPreviewBody
        artifactId={artifactId}
        filename={filename}
        href={href}
        mode={mode}
      />
    </HoverPreview>
  )
}

function ArtifactPreviewBody({
  artifactId,
  filename,
  href,
  mode,
}: {
  artifactId: string
  filename: string
  href: string
  mode: ArtifactPreviewMode
}) {
  if (mode === 'image') {
    return (
      // Artifact bytes come from the project-scoped API; next/image is not applicable.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={href}
        alt={filename}
        className="max-h-[min(288px,calc(100vh-5rem))] w-full object-contain"
      />
    )
  }

  if (mode === 'unsupported') {
    return (
      <p className="px-1 py-6 text-center text-[11px] text-ds-text-muted">
        本文件不支持文本预览，点击芯片在新标签打开
      </p>
    )
  }

  return <TextPreviewBody key={artifactId} artifactId={artifactId} href={href} />
}

function TextPreviewBody({
  artifactId,
  href,
}: {
  artifactId: string
  href: string
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; text: string; truncated: boolean }
    | { status: 'error' }
  >(() => readCachedPreview(artifactId) ?? { status: 'loading' })

  useEffect(() => {
    if (textCache.has(artifactId)) return

    const controller = new AbortController()

    void fetch(href, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('fetch failed')
        return response.text()
      })
      .then((text) => {
        textCache.set(artifactId, text)
        setState({
          status: 'ready',
          text: text.slice(0, TEXT_PREVIEW_LIMIT),
          truncated: text.length > TEXT_PREVIEW_LIMIT,
        })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [artifactId, href])

  if (state.status === 'loading') {
    return (
      <div className="space-y-2 p-1" aria-busy aria-label="加载中">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[83%]" />
        <Skeleton className="h-3 w-[80%]" />
        <p className="pt-1 text-[11px] text-ds-text-muted">加载中</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="px-1 py-6 text-center text-[11px] text-ds-text-muted">
        预览加载失败，点击芯片在新标签打开
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ds-text">
        {state.text}
      </pre>
      {state.truncated ? (
        <p className="border-t border-ds-border pt-2 text-[11px] text-ds-text-muted">
          内容过长，已截断；点击芯片打开完整文件
        </p>
      ) : null}
    </div>
  )
}

function readCachedPreview(artifactId: string):
  | { status: 'ready'; text: string; truncated: boolean }
  | undefined {
  const cached = textCache.get(artifactId)
  if (cached === undefined) return undefined
  return {
    status: 'ready',
    text: cached.slice(0, TEXT_PREVIEW_LIMIT),
    truncated: cached.length > TEXT_PREVIEW_LIMIT,
  }
}
