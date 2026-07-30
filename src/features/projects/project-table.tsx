'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusPill } from '@/components/ui/status-pill'
import { productCanvasHref } from '@/features/navigation/products-routes'
import { isProjectWorkflowKind, type ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import {
  projectKindMeta,
  type ProjectCardItem,
  type ProjectKindCounts,
} from './project-cards-client'

export interface ProjectTableProps {
  /** tab 顺序（按数量降序）。 */
  kinds: readonly ProjectWorkflowKind[]
  counts: ProjectKindCounts
  activeKind: ProjectWorkflowKind
  onKindChange: (kind: ProjectWorkflowKind) => void
  items: readonly ProjectCardItem[]
  /** 搜索时跨板块混合展示，隐藏 tab 并在行内标注板块。 */
  searchMode: boolean
  searchTotal: number
  hasMore: boolean
  loading: boolean
  error: string | null
  onLoadMore: () => void
  emptyLabel: string
  emptyAction?: ReactNode
}

/** 列表布局：顶部板块 tab + 名称/状态/来源/更新时间四列，触底按钮式追加。 */
export function ProjectTable({
  kinds,
  counts,
  activeKind,
  onKindChange,
  items,
  searchMode,
  searchTotal,
  hasMore,
  loading,
  error,
  onLoadMore,
  emptyLabel,
  emptyAction,
}: ProjectTableProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {searchMode ? (
        <p className="text-xs text-ds-text-muted">
          跨三个板块共 {searchTotal} 个命中
        </p>
      ) : (
        <SegmentedControl
          options={kinds.map((kind) => ({
            value: kind,
            label: `${projectKindMeta(kind).title} ${counts[kind]}`,
          }))}
          value={activeKind}
          onChange={(value) => {
            if (isProjectWorkflowKind(value)) onKindChange(value)
          }}
        />
      )}
      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-ds-border bg-ds-surface">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,1.6fr)_120px_minmax(0,2fr)_170px] gap-3 border-b border-ds-border px-4 py-2.5 text-xs font-medium text-ds-text-muted">
              <span>名称</span>
              <span>状态</span>
              <span>来源</span>
              <span>更新时间</span>
            </div>
            {items.map((item) => (
              <TableRow key={item.id} item={item} showKind={searchMode} />
            ))}
          </div>
        </div>
      ) : (
        <div className="ds-dot-grid flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ds-border px-5 text-center">
          <p className="text-sm text-ds-text-muted">
            {loading ? '正在加载…' : emptyLabel}
          </p>
          {!loading && emptyAction}
        </div>
      )}
      {error && <p className="text-xs text-ds-red">{error}</p>}
      {(hasMore || error) && items.length > 0 && (
        <Button
          variant="gray"
          size="sm"
          className="self-center"
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading ? '加载中…' : error ? '重试' : '加载更多'}
        </Button>
      )}
    </div>
  )
}

function TableRow({ item, showKind }: { item: ProjectCardItem; showKind: boolean }) {
  const meta = projectKindMeta(item.kind)
  return (
    <Link
      href={productCanvasHref(item.id)}
      className="grid grid-cols-[minmax(0,1.6fr)_120px_minmax(0,2fr)_170px] items-center gap-3 border-b border-ds-border px-4 py-3 transition-colors last:border-b-0 hover:bg-ds-surface-muted"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-ds-text">
          {item.title}
        </span>
        {showKind && (
          <span className="shrink-0 rounded-full border border-ds-border bg-ds-surface-muted px-2 py-0.5 text-[11px] text-ds-text-muted">
            {meta.title}
          </span>
        )}
      </span>
      <span>
        <StatusPill variant={item.status} />
      </span>
      <SourceCell item={item} />
      <span className="text-xs text-ds-text-muted">{item.updatedLabel}</span>
    </Link>
  )
}

function SourceCell({ item }: { item: ProjectCardItem }) {
  if (!item.sourceSummary) {
    return <span className="text-xs text-ds-text-muted">来源信息缺失</span>
  }
  // URL 与文件名用 mono 提升可辨识度；文稿摘录保持正文字体。
  const mono = item.kind !== 'script'
  return (
    <span
      className={
        mono
          ? 'truncate font-mono text-xs text-ds-text-muted'
          : 'truncate text-xs text-ds-text-muted'
      }
      title={item.sourceSummary}
    >
      {item.sourceSummary}
    </span>
  )
}
