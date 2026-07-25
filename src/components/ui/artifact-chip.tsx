import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface ArtifactChipProps {
  icon?: ComponentType<{ className?: string }>
  filename: string
  /** 真实产物的下载/预览地址；提供后芯片渲染为可点击链接，否则保持纯展示。 */
  href?: string
  className?: string
}

/**
 * 工件文件名芯片（SSOT）。
 * canvas.pen Canonical: ds-surface-muted 底、6px 圆角、边框、px-2 py-[5px]。
 */
export function ArtifactChip({ icon: Icon, filename, href, className }: ArtifactChipProps) {
  const classes = cn(
    'inline-flex items-center gap-[7px] rounded-md border border-ds-border bg-ds-surface-muted px-2 py-[5px] text-ds-text',
    href && 'transition-colors hover:brightness-95',
    className,
  )
  const content = (
    <>
      {Icon && <Icon className="size-[13px] text-ds-text-muted" />}
      <span className="text-[11px] font-mono">{filename}</span>
    </>
  )

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {content}
      </a>
    )
  }

  return <div className={classes}>{content}</div>
}
