'use client'

import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ProjectCard } from '@/components/ui/project-card'
import { productCanvasHref } from '@/features/navigation/products-routes'
import { TRANSITION_ENTER, TRANSITION_EXIT } from '@/lib/motion/tokens'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import {
  projectCardMetaText,
  projectKindMeta,
  type ProjectCardItem,
} from './project-cards-client'

export interface ProjectKindRowProps {
  kind: ProjectWorkflowKind
  items: readonly ProjectCardItem[]
  totalCount: number
  loading: boolean
  error: string | null
  /** 未提供时该行不出现追加加载（搜索混合结果由外层统一加载更多）。 */
  onLoadMore?: () => void
  emptyLabel: string
  emptyAction?: ReactNode
}

/**
 * 板块横向行：左列标题固定，右列卡片轨道横向滚动；
 * 轨道尾部哨兵进入视口即拉取下一页，避免一次性全量加载。
 */
export function ProjectKindRow({
  kind,
  items,
  totalCount,
  loading,
  error,
  onLoadMore,
  emptyLabel,
  emptyAction,
}: ProjectKindRowProps) {
  const meta = projectKindMeta(kind)
  const Icon = meta.icon
  const hasMore = items.length < totalCount && onLoadMore !== undefined

  return (
    <section className="grid min-w-0 gap-4 border-b border-ds-border pb-6 last:border-b-0 last:pb-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
      <header className="relative flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-ds-border bg-ds-surface text-ds-text-muted">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ds-text">
                {meta.title}
              </h2>
              <span className="shrink-0 rounded-full border border-ds-border bg-ds-surface-muted px-2 py-0.5 font-mono text-xs text-ds-text-muted">
                {totalCount}
              </span>
            </div>
            <KindDescription
              description={meta.description}
              detail={meta.detail}
            />
          </div>
        </div>
        {/* 印章式大图标：固定跟随简介下方，三行间距统一；纯装饰不拦截交互。 */}
        <Icon
          aria-hidden
          className="pointer-events-none mt-3 hidden size-20 -rotate-6 self-start text-ds-text opacity-[0.06] lg:block"
        />
      </header>
      <div className="min-w-0">
        {items.length > 0 ? (
          <CardTrack
            items={items}
            hasMore={hasMore}
            loading={loading}
            error={error}
            onLoadMore={onLoadMore}
          />
        ) : (
          <div className="ds-dot-grid flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ds-border px-5 text-center">
            <p className="text-sm text-ds-text-muted">
              {loading ? '正在加载…' : emptyLabel}
            </p>
            {!loading && emptyAction}
          </div>
        )}
      </div>
    </section>
  )
}

/** 板块简介：悬浮/键盘聚焦时缓动展开详细介绍，离开收起。 */
function KindDescription({
  description,
  detail,
}: {
  description: string
  detail: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      tabIndex={0}
      className="mt-1 cursor-default rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      <p className="text-xs leading-5 text-ds-text-muted">{description}</p>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.p
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: TRANSITION_ENTER }}
            exit={{ height: 0, opacity: 0, transition: TRANSITION_EXIT }}
            className="overflow-hidden text-xs leading-5 text-ds-text-muted"
          >
            <span className="mt-1 block border-t border-ds-border pt-1.5">
              {detail}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function CardTrack({
  items,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  items: readonly ProjectCardItem[]
  hasMore: boolean
  loading: boolean
  error: string | null
  onLoadMore?: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = trackRef.current
    const sentinel = sentinelRef.current
    if (!track || !sentinel || !hasMore || loading || !onLoadMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root: track, rootMargin: '0px 200px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, onLoadMore])

  return (
    <div ref={trackRef} className="flex min-w-0 gap-4 overflow-x-auto pb-2">
      {items.map((item) => (
        <Link
          key={item.id}
          href={productCanvasHref(item.id)}
          className="block w-[300px] shrink-0"
        >
          <ProjectCard
            title={item.title}
            meta={projectCardMetaText(item)}
            status={item.status}
            className="w-full"
          />
        </Link>
      ))}
      {(hasMore || loading || error) && (
        <div
          ref={sentinelRef}
          className="flex w-[140px] shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ds-border px-3 text-center"
        >
          {error ? (
            <>
              <p className="text-xs text-ds-red">{error}</p>
              <Button variant="gray" size="sm" onClick={onLoadMore}>
                重试
              </Button>
            </>
          ) : (
            <Button
              variant="gray"
              size="sm"
              disabled={loading}
              onClick={onLoadMore}
            >
              {loading ? '加载中…' : '加载更多'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
