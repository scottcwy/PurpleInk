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
 * canvas.pen: fill 底、rounded-sm、h-[26px]、gap-1.5、px-2 py-1。
 */
export function ArtifactChip({ icon: Icon, filename, href, className }: ArtifactChipProps) {
  const classes = cn(
    'inline-flex h-[26px] items-center gap-1.5 rounded-sm bg-fill px-2 py-1',
    href && 'transition-colors hover:bg-fill-strong',
    className,
  )
  const content = (
    <>
      {Icon && <Icon className="h-3 w-3 text-label-secondary" />}
      <span className="text-[11px] font-mono text-label">{filename}</span>
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
