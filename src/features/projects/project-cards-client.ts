import { AudioLines, FileCode, Globe, type LucideIcon } from 'lucide-react'
import type {
  ProjectCardItem,
  ProjectCardPage,
  ProjectKindCounts,
} from './project-cards'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

export type { ProjectCardItem, ProjectCardPage, ProjectKindCounts }

export interface ProjectKindMeta {
  kind: ProjectWorkflowKind
  icon: LucideIcon
  title: string
  shortLabel: string
  description: string
  /** 悬浮展开的详细介绍，口径以 docs/conventions/project-workflows.md 为准。 */
  detail: string
}

/** 三板块的展示元信息；顺序即数量相同时的固定 tie-break 顺序。 */
export const PROJECT_KIND_META: readonly ProjectKindMeta[] = [
  {
    kind: 'script',
    icon: FileCode,
    title: '代码视频',
    shortLabel: '代码（文稿）',
    description: '文稿驱动：配音、分镜与代码生成渲染主链路。',
    detail:
      '粘贴文稿后由 Director 编排：先合成配音与分镜规划，再逐镜生成代码并渲染，最终在项目画布上合成 1920×1080 横屏成片。',
  },
  {
    kind: 'audio',
    icon: AudioLines,
    title: '录音视频',
    shortLabel: '录音',
    description: '原声时间轴：录音转写后复用分镜与渲染，不重复配音。',
    detail:
      '上传 MP3/WAV 原声（最大 100 MB），服务端转写并对齐原声时间轴，复用文稿链路的分镜与渲染能力，不再重复 TTS 配音。',
  },
  {
    kind: 'website',
    icon: Globe,
    title: 'URL 介绍视频',
    shortLabel: 'URL 介绍',
    description: 'Playwright 采集网站证据，复用成熟生视频引擎。',
    detail:
      '提交公开的 HTTP(S) 地址，Playwright 真实采集页面证据后交由成熟生视频引擎编排渲染，产物统一挂载到项目画布。',
  },
] as const

export function projectKindMeta(kind: ProjectWorkflowKind): ProjectKindMeta {
  const meta = PROJECT_KIND_META.find((entry) => entry.kind === kind)
  if (!meta) throw new Error(`未知项目板块：${kind}`)
  return meta
}

/** 数量多的板块排前；相同数量按 PROJECT_KIND_META 固定顺序。 */
export function sortKindsByCount(
  counts: ProjectKindCounts,
): ProjectWorkflowKind[] {
  return PROJECT_KIND_META.map((meta) => meta.kind).sort(
    (left, right) => counts[right] - counts[left],
  )
}

/** 追加下一页并按 id 去重（并发加载或数据窗口移动时防重复卡片）。 */
export function appendUniqueItems(
  existing: readonly ProjectCardItem[],
  incoming: readonly ProjectCardItem[],
): ProjectCardItem[] {
  const seen = new Set(existing.map((item) => item.id))
  const merged = [...existing]
  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

export function groupItemsByKind(
  items: readonly ProjectCardItem[],
): Record<ProjectWorkflowKind, ProjectCardItem[]> {
  const groups: Record<ProjectWorkflowKind, ProjectCardItem[]> = {
    script: [],
    audio: [],
    website: [],
  }
  for (const item of items) groups[item.kind].push(item)
  return groups
}

/** 网格卡片的元信息行，与旧版口径一致。 */
export function projectCardMetaText(item: ProjectCardItem): string {
  if (item.kind === 'website') return `网站介绍 · ${item.updatedLabel}`
  const source = item.kind === 'audio' ? '原录音' : '文稿'
  return `${source} · ${item.shotCount} 个镜头 · ${item.updatedLabel}`
}

export interface FetchProjectCardsInput {
  kind?: ProjectWorkflowKind
  q?: string
  offset: number
  limit: number
  signal?: AbortSignal
}

/** 走 `/api/projects?view=cards` 的分页读取；失败抛出带类别文案的 Error。 */
export async function fetchProjectCards(
  input: FetchProjectCardsInput,
): Promise<ProjectCardPage> {
  const params = new URLSearchParams({
    view: 'cards',
    offset: String(input.offset),
    limit: String(input.limit),
  })
  if (input.kind) params.set('kind', input.kind)
  if (input.q) params.set('q', input.q)
  const response = await fetch(`/api/projects?${params.toString()}`, {
    signal: input.signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error('项目列表加载失败，请稍后重试')
  return (await response.json()) as ProjectCardPage
}
