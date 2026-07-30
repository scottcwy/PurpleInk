'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import {
  appendUniqueItems,
  fetchProjectCards,
  groupItemsByKind,
  sortKindsByCount,
  type ProjectCardItem,
  type ProjectKindCounts,
} from './project-cards-client'

const LAYOUT_STORAGE_KEY = 'purpleink-projects-layout'
const LAYOUT_CHANGE_EVENT = 'purpleink-projects-layout-change'
const SEARCH_PAGE_SIZE = 50
const ZERO_COUNTS: ProjectKindCounts = { script: 0, audio: 0, website: 0 }

export type LayoutMode = 'grid' | 'list'

// 布局偏好是纯视图状态：localStorage 作为外部存储接入，SSR 回退网格。
function subscribeLayout(callback: () => void): () => void {
  window.addEventListener('storage', callback)
  window.addEventListener(LAYOUT_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(LAYOUT_CHANGE_EVENT, callback)
  }
}

function readLayout(): LayoutMode {
  return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'list'
    ? 'list'
    : 'grid'
}

export interface KindState {
  items: ProjectCardItem[]
  loading: boolean
  error: string | null
}

interface SearchResult {
  q: string
  items: ProjectCardItem[]
  counts: ProjectKindCounts
  total: number
  error: string | null
}

export interface SearchState extends SearchResult {
  loading: boolean
}

export interface ProjectCardsStateInput {
  initialPages: Record<ProjectWorkflowKind, ProjectCardItem[]>
  initialCounts: ProjectKindCounts
  pageSize: number
}

/**
 * 项目页客户端状态：布局偏好、板块分页、服务端搜索与追加加载。
 * 数据窗口只随用户滚动增长，永不整表拉取。
 */
export function useProjectCardsState({
  initialPages,
  initialCounts,
  pageSize,
}: ProjectCardsStateInput) {
  const layout = useSyncExternalStore<LayoutMode>(
    subscribeLayout,
    readLayout,
    () => 'grid',
  )
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [counts, setCounts] = useState(initialCounts)
  const [kindStates, setKindStates] = useState<
    Record<ProjectWorkflowKind, KindState>
  >({
    script: { items: initialPages.script, loading: false, error: null },
    audio: { items: initialPages.audio, loading: false, error: null },
    website: { items: initialPages.website, loading: false, error: null },
  })
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchLoadingMore, setSearchLoadingMore] = useState(false)
  const [activeKind, setActiveKind] = useState<ProjectWorkflowKind>(
    () => sortKindsByCount(initialCounts)[0] ?? 'script',
  )

  // 派生搜索视图：结果落后于当前关键词时视为加载中，effect 内不再同步 setState。
  const search = useMemo<SearchState | null>(() => {
    if (!debouncedQuery) return null
    if (searchResult && searchResult.q === debouncedQuery) {
      return { ...searchResult, loading: searchLoadingMore }
    }
    return {
      q: debouncedQuery,
      items: [],
      counts: ZERO_COUNTS,
      total: 0,
      error: null,
      loading: true,
    }
  }, [debouncedQuery, searchResult, searchLoadingMore])

  // 事件回调里读最新状态用；避免在 setState updater 内发起副作用。
  const kindStatesRef = useRef(kindStates)
  const searchRef = useRef(search)
  useEffect(() => {
    kindStatesRef.current = kindStates
  }, [kindStates])
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const changeLayout = useCallback((value: string) => {
    if (value !== 'grid' && value !== 'list') return
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, value)
    window.dispatchEvent(new Event(LAYOUT_CHANGE_EVENT))
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(handle)
  }, [query])

  // 搜索走服务端：跨板块混合返回，两种布局共用同一结果集。
  useEffect(() => {
    if (!debouncedQuery) return
    const controller = new AbortController()
    fetchProjectCards({
      q: debouncedQuery,
      offset: 0,
      limit: SEARCH_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((page) => {
        setSearchResult({
          q: debouncedQuery,
          items: page.items,
          counts: page.kindCounts,
          total: page.total,
          error: null,
        })
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setSearchResult({
          q: debouncedQuery,
          items: [],
          counts: ZERO_COUNTS,
          total: 0,
          error: cause instanceof Error ? cause.message : '搜索失败，请稍后重试',
        })
      })
    return () => controller.abort()
  }, [debouncedQuery])

  const loadMoreKind = useCallback(
    (kind: ProjectWorkflowKind) => {
      const state = kindStatesRef.current[kind]
      if (state.loading) return
      setKindStates((current) => ({
        ...current,
        [kind]: { ...current[kind], loading: true, error: null },
      }))
      fetchProjectCards({
        kind,
        offset: state.items.length,
        limit: pageSize,
      })
        .then((page) => {
          setCounts(page.kindCounts)
          setKindStates((next) => ({
            ...next,
            [kind]: {
              items: appendUniqueItems(next[kind].items, page.items),
              loading: false,
              error: null,
            },
          }))
        })
        .catch((cause) => {
          setKindStates((next) => ({
            ...next,
            [kind]: {
              ...next[kind],
              loading: false,
              error:
                cause instanceof Error ? cause.message : '加载失败，请稍后重试',
            },
          }))
        })
    },
    [pageSize],
  )

  const loadMoreSearch = useCallback(() => {
    const current = searchRef.current
    if (!current || current.loading) return
    setSearchLoadingMore(true)
    fetchProjectCards({
      q: current.q,
      offset: current.items.length,
      limit: SEARCH_PAGE_SIZE,
    })
      .then((page) => {
        setSearchResult((next) =>
          next && next.q === current.q
            ? {
                ...next,
                items: appendUniqueItems(next.items, page.items),
                counts: page.kindCounts,
                total: page.total,
                error: null,
              }
            : next,
        )
      })
      .catch((cause) => {
        setSearchResult((next) =>
          next && next.q === current.q
            ? {
                ...next,
                error:
                  cause instanceof Error ? cause.message : '加载失败，请稍后重试',
              }
            : next,
        )
      })
      .finally(() => setSearchLoadingMore(false))
  }, [])

  const rowOrder = useMemo(
    () => sortKindsByCount(search ? search.counts : counts),
    [search, counts],
  )
  const searchGroups = useMemo(
    () => (search ? groupItemsByKind(search.items) : null),
    [search],
  )
  const searchHasMore = search ? search.items.length < search.total : false

  return {
    layout,
    changeLayout,
    query,
    setQuery,
    counts,
    kindStates,
    search,
    searching: search !== null,
    searchGroups,
    searchHasMore,
    rowOrder,
    activeKind,
    setActiveKind,
    loadMoreKind,
    loadMoreSearch,
  }
}
