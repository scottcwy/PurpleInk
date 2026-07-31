'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TopBar } from '@/components/ui/top-bar'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import {
  projectKindMeta,
  type ProjectCardItem,
  type ProjectKindCounts,
} from './project-cards-client'
import { ProjectKindRow } from './project-kind-row'
import { useProjectContextMenu } from './project-context-menu'
import { ProjectSearchFlyout } from './project-search-flyout'
import { ProjectTable } from './project-table'
import {
  useProjectCardsState,
  type SearchState,
} from './use-project-cards-state'

export interface ProjectListProps {
  /** 三板块合计项目数，顶栏展示。 */
  total: number
  initialPages: Record<ProjectWorkflowKind, ProjectCardItem[]>
  initialCounts: ProjectKindCounts
  /** 追加加载的每页条数，与首屏每板块条数一致。 */
  pageSize: number
  /** 顶栏右侧新建入口（由页面注入，保持 server 组合）。 */
  newProjectAction?: ReactNode
  /** 按来源提供空板块创建入口；搜索无命中时不展示。 */
  emptyActions?: Partial<Record<ProjectWorkflowKind, ReactNode>>
}

export function ProjectList({
  total,
  initialPages,
  initialCounts,
  pageSize,
  newProjectAction,
  emptyActions,
}: ProjectListProps) {
  const state = useProjectCardsState({ initialPages, initialCounts, pageSize })
  const {
    layout,
    changeLayout,
    query,
    setQuery,
    counts,
    kindStates,
    search,
    searching,
    searchGroups,
    searchHasMore,
    rowOrder,
    activeKind,
    setActiveKind,
    loadMoreKind,
    loadMoreSearch,
    renameItem,
    removeItem,
  } = state

  // 整页只持有一个菜单实例，网格卡片与列表行共用同一批 handler。
  const projectMenu = useProjectContextMenu({
    onRenamed: renameItem,
    onDeleted: removeItem,
  })

  return (
    <>
      <TopBar
        title="项目"
        meta={
          <span className="inline-flex items-center gap-1.5">
            共 {total} 个真实项目
            <ProjectSearchFlyout query={query} onQueryChange={setQuery} />
          </span>
        }
        actions={
          <>
            {/* 高度与右侧 sm 新建按钮（h-8）对齐；<lg 选项补足 40px 触控热区。 */}
            <SegmentedControl
              options={[
                { value: 'grid', label: '网格' },
                { value: 'list', label: '列表' },
              ]}
              value={layout}
              onChange={changeLayout}
              className="h-8 shrink-0 [&>button]:py-0.5 max-lg:h-auto max-lg:[&>button]:min-h-10"
            />
            {newProjectAction}
          </>
        }
      />
      <div className="flex w-full min-w-0 flex-col gap-6 px-4 py-5 sm:px-7 sm:py-6">
        {layout === 'grid' ? (
          <div className="flex min-w-0 flex-col gap-6">
            {rowOrder.map((kind) => {
              const meta = projectKindMeta(kind)
              const kindState = kindStates[kind]
              return (
                <ProjectKindRow
                  key={kind}
                  kind={kind}
                  items={searchGroups ? searchGroups[kind] : kindState.items}
                  totalCount={search ? search.counts[kind] : counts[kind]}
                  loading={search ? search.loading : kindState.loading}
                  error={search ? null : kindState.error}
                  onLoadMore={searching ? undefined : () => loadMoreKind(kind)}
                  emptyLabel={
                    search
                      ? `没有匹配“${search.q}”的${meta.shortLabel}项目`
                      : `还没有${meta.shortLabel}项目`
                  }
                  emptyAction={searching ? undefined : emptyActions?.[kind]}
                  onProjectContextMenu={projectMenu.openMenu}
                />
              )
            })}
            {searching && (search?.error || searchHasMore) && (
              <SearchLoadMore search={search} onLoadMore={loadMoreSearch} />
            )}
          </div>
        ) : (
          <ProjectTable
            kinds={rowOrder}
            counts={counts}
            activeKind={activeKind}
            onKindChange={setActiveKind}
            items={search ? search.items : kindStates[activeKind].items}
            searchMode={searching}
            searchTotal={search?.total ?? 0}
            hasMore={
              search
                ? searchHasMore
                : kindStates[activeKind].items.length < counts[activeKind]
            }
            loading={search ? search.loading : kindStates[activeKind].loading}
            error={search ? search.error : kindStates[activeKind].error}
            onLoadMore={search ? loadMoreSearch : () => loadMoreKind(activeKind)}
            emptyLabel={
              search
                ? `没有匹配“${search.q}”的项目`
                : `还没有${projectKindMeta(activeKind).shortLabel}项目`
            }
            emptyAction={searching ? undefined : emptyActions?.[activeKind]}
            onProjectContextMenu={projectMenu.openMenu}
          />
        )}
      </div>
      {projectMenu.overlay}
    </>
  )
}

function SearchLoadMore({
  search,
  onLoadMore,
}: {
  search: SearchState | null
  onLoadMore: () => void
}) {
  if (!search) return null
  return (
    <div className="flex flex-col items-center gap-2">
      {search.error && <p className="text-xs text-ds-red">{search.error}</p>}
      <Button
        variant="gray"
        size="sm"
        disabled={search.loading}
        onClick={onLoadMore}
      >
        {search.loading ? '加载中…' : search.error ? '重试' : '加载更多命中'}
      </Button>
    </div>
  )
}
