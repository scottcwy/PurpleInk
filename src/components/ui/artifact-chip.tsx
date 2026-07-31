import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface ArtifactChipProps {
  icon?: ComponentType<{ className?: string }>
  filename: string
  /** 真实产物的下载/预览地址；提供后芯片渲染为可点击链接，否则保持纯展示。 */
  href?: string
  /**
   * 以附件方式保存而不是新标签页预览。
   *
   * `download` 与 `target="_blank"` 互斥：同时给会让部分浏览器先开新标签页再下载，
   * 留下一个空白页。所以下载态不带 target。
   */
  download?: boolean
  className?: string
}

/**
 * 工件文件名芯片（SSOT）。
 * canvas.pen Canonical: ds-surface-muted 底、6px 圆角、边框、px-2 py-[5px]。
 */
export function ArtifactChip({
  icon: Icon,
  filename,
  href,
  download,
  className,
}: ArtifactChipProps) {
  const classes = cn(
    'inline-flex items-center gap-[7px] rounded-md border border-ds-border bg-ds-surface-muted px-2 py-[5px] text-ds-text',
    href && 'transition-colors duration-fast ease-standard hover:bg-ds-surface',
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
      <a
        href={href}
        className={classes}
        {...(download
          ? { download: filename }
          : { target: '_blank', rel: 'noreferrer' })}
      >
        {content}
      </a>
    )
  }

  return <div className={classes}>{content}</div>
}
