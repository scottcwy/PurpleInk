import type { ComponentType } from 'react'
import { LucideCatalogDemo } from '@/components/icons/lucide-catalog.demo'
import { ArtifactChipDemo } from '@/components/ui/artifact-chip.demo'
import { ButtonDemo } from '@/components/ui/button.demo'
import { CollapsibleCardDemo } from '@/components/ui/collapsible-card.demo'
import { DialogDemo } from '@/components/ui/dialog.demo'
import { EmptyStateDemo } from '@/components/ui/empty-state.demo'
import { IconButtonDemo } from '@/components/ui/icon-button.demo'
import { NavItemDemo } from '@/components/ui/nav-item.demo'
import { SidebarDemo } from '@/components/ui/sidebar.demo'
import { TopBarDemo } from '@/components/ui/top-bar.demo'
import { ProgressBarDemo } from '@/components/ui/progress-bar.demo'
import { ResizeHandleDemo } from '@/components/ui/resize-handle.demo'
import { ContactSheetThumbDemo } from '@/components/ui/contact-sheet-thumb.demo'
import { ProjectCardDemo } from '@/components/ui/project-card.demo'
import { QueueStatusBarDemo } from '@/components/ui/queue-status-bar.demo'
import { SearchFieldDemo } from '@/components/ui/search-field.demo'
import { SegmentedControlDemo } from '@/components/ui/segmented-control.demo'
import { SettingsGroupDemo } from '@/components/ui/settings-group.demo'
import { SettingsRowDemo } from '@/components/ui/settings-row.demo'
import { SkeletonDemo } from '@/components/ui/skeleton.demo'
import { TimelineTrackDemo } from '@/components/ui/timeline-track.demo'
import { StatusPillDemo } from '@/components/ui/status-pill.demo'
import { TextAreaDemo } from '@/components/ui/text-area.demo'
import { TextFieldDemo } from '@/components/ui/text-field.demo'
import { ToastDemo } from '@/components/ui/toast.demo'
import { ToggleDemo } from '@/components/ui/toggle.demo'
import { AudioNodeDemo } from '@/components/ui/node/audio-node.demo'
import { ExportNodeDemo } from '@/components/ui/node/export-node.demo'
import { StageNodeDemo } from '@/components/ui/node/stage-node.demo'
import { ShotNodeDemo } from '@/components/ui/node/shot-node.demo'
import { TooltipDemo } from '@/components/ui/tooltip.demo'

export type PlaybookCategory = 'ui' | 'icons'

export interface PlaybookEntry {
  id: string
  name: string
  category: PlaybookCategory
  Demo: ComponentType
}

export const PENCIL_REUSABLE_SYMBOL_COUNT = 31
export const PENCIL_COMPONENT_FAMILY_COUNT = 28
/** Pencil 族之外的交互原语（如 ResizeHandle / Skeleton）计入 UI 登记总数。 */
export const UI_COMPONENT_FAMILY_COUNT = 30
export const PENCIL_CONSOLIDATION_NOTE =
  'Button/Primary、Tinted、Gray、Destructive 四个 Pencil symbols 由一个 Button 组件的 variant 承载。'

/**
 * Track P 组件手册登记表。UI 分类只登记可追溯到 canvas.pen reusable symbol
 * 的组件族；Icons 分类是 Pencil A4 白名单目录，不是额外视觉原语。
 */
export const PLAYBOOK_ENTRIES: PlaybookEntry[] = [
  { id: 'artifact-chip', name: 'ArtifactChip', category: 'ui', Demo: ArtifactChipDemo },
  { id: 'audio-node', name: 'AudioNode', category: 'ui', Demo: AudioNodeDemo },
  { id: 'button', name: 'Button', category: 'ui', Demo: ButtonDemo },
  { id: 'collapsible-card', name: 'CollapsibleCard', category: 'ui', Demo: CollapsibleCardDemo },
  { id: 'contact-sheet-thumb', name: 'ContactSheetThumb', category: 'ui', Demo: ContactSheetThumbDemo },
  { id: 'export-node', name: 'ExportNode', category: 'ui', Demo: ExportNodeDemo },
  { id: 'dialog', name: 'Dialog', category: 'ui', Demo: DialogDemo },
  { id: 'empty-state', name: 'EmptyState', category: 'ui', Demo: EmptyStateDemo },
  { id: 'icon-button', name: 'IconButton', category: 'ui', Demo: IconButtonDemo },
  { id: 'nav-item', name: 'NavItem', category: 'ui', Demo: NavItemDemo },
  { id: 'sidebar', name: 'Sidebar', category: 'ui', Demo: SidebarDemo },
  { id: 'top-bar', name: 'TopBar', category: 'ui', Demo: TopBarDemo },
  { id: 'progress-bar', name: 'ProgressBar', category: 'ui', Demo: ProgressBarDemo },
  { id: 'project-card', name: 'ProjectCard', category: 'ui', Demo: ProjectCardDemo },
  { id: 'resize-handle', name: 'ResizeHandle', category: 'ui', Demo: ResizeHandleDemo },
  { id: 'queue-status-bar', name: 'QueueStatusBar', category: 'ui', Demo: QueueStatusBarDemo },
  { id: 'search-field', name: 'SearchField', category: 'ui', Demo: SearchFieldDemo },
  { id: 'segmented-control', name: 'SegmentedControl', category: 'ui', Demo: SegmentedControlDemo },
  { id: 'settings-group', name: 'SettingsGroup', category: 'ui', Demo: SettingsGroupDemo },
  { id: 'settings-row', name: 'SettingsRow', category: 'ui', Demo: SettingsRowDemo },
  { id: 'skeleton', name: 'Skeleton', category: 'ui', Demo: SkeletonDemo },
  { id: 'shot-node', name: 'ShotNode', category: 'ui', Demo: ShotNodeDemo },
  { id: 'stage-node', name: 'StageNode', category: 'ui', Demo: StageNodeDemo },
  { id: 'status-pill', name: 'StatusPill', category: 'ui', Demo: StatusPillDemo },
  { id: 'text-area', name: 'TextArea', category: 'ui', Demo: TextAreaDemo },
  { id: 'text-field', name: 'TextField', category: 'ui', Demo: TextFieldDemo },
  { id: 'timeline-track', name: 'TimelineTrack', category: 'ui', Demo: TimelineTrackDemo },
  { id: 'toast', name: 'Toast', category: 'ui', Demo: ToastDemo },
  { id: 'toggle', name: 'Toggle', category: 'ui', Demo: ToggleDemo },
  { id: 'tooltip', name: 'Tooltip', category: 'ui', Demo: TooltipDemo },
  { id: 'lucide-catalog', name: 'Lucide 白名单', category: 'icons', Demo: LucideCatalogDemo },
]

export function entriesByCategory(category: PlaybookCategory): PlaybookEntry[] {
  return PLAYBOOK_ENTRIES.filter((entry) => entry.category === category)
}
