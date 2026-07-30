import type { ComponentType } from "react";
import { LucideCatalogDemo } from "@/components/icons/lucide-catalog.demo";
import { ArtifactChipDemo } from "@/components/ui/artifact-chip.demo";
import { PipelineNodeDemo } from "@/components/ui/pipeline-node.demo";
import { ProjectStatisticsPanelDemo } from "@/components/ui/project-statistics-panel.demo";
import { UsageTrendChartDemo } from "@/components/ui/usage-trend-chart.demo";
import { PurpleInkLogoDemo } from "@/components/ui/purple-ink-logo.demo";
import { RecentProjectsPanelDemo } from "@/components/ui/recent-projects-panel.demo";
import {
  AccountMenuDemo,
  SidebarAccountDemo,
  SidebarToggleDemo,
} from "@/components/ui/sidebar-chrome.demo";
import { ButtonDemo } from "@/components/ui/button.demo";
import { CollapsibleCardDemo } from "@/components/ui/collapsible-card.demo";
import { ContextMenuDemo } from "@/components/ui/context-menu.demo";
import { DialogDemo } from "@/components/ui/dialog.demo";
import { EmptyStateDemo } from "@/components/ui/empty-state.demo";
import { IconButtonDemo } from "@/components/ui/icon-button.demo";
import { MediaViewportDemo } from "@/components/ui/media-viewport.demo";
import { NavItemDemo } from "@/components/ui/nav-item.demo";
import { HoverPreviewDemo } from "@/components/ui/hover-preview.demo";
import { HumanCheckFieldDemo } from "@/components/ui/human-check-field.demo";
import { VerificationCodeFieldDemo } from "@/components/ui/verification-code-field.demo";
import { PopoverDemo } from "@/components/ui/popover.demo";
import { SidebarDemo } from "@/components/ui/sidebar.demo";
import { TopBarDemo } from "@/components/ui/top-bar.demo";
import { ProgressBarDemo } from "@/components/ui/progress-bar.demo";
import { ResizeHandleDemo } from "@/components/ui/resize-handle.demo";
import { ContactSheetThumbDemo } from "@/components/ui/contact-sheet-thumb.demo";
import { ProjectCardDemo } from "@/components/ui/project-card.demo";
import { QueueStatusBarDemo } from "@/components/ui/queue-status-bar.demo";
import { SearchFieldDemo } from "@/components/ui/search-field.demo";
import { SectionNavDemo } from "@/components/ui/section-nav.demo";
import { SegmentedControlDemo } from "@/components/ui/segmented-control.demo";
import { SettingsGroupDemo } from "@/components/ui/settings-group.demo";
import { SettingsFieldDemo } from "@/components/ui/settings-field.demo";
import { SettingsPanelDemo } from "@/components/ui/settings-panel.demo";
import { SettingsRowDemo } from "@/components/ui/settings-row.demo";
import { SkeletonDemo } from "@/components/ui/skeleton.demo";
import { TimelineTrackDemo } from "@/components/ui/timeline-track.demo";
import { StatusPillDemo } from "@/components/ui/status-pill.demo";
import { TextAreaDemo } from "@/components/ui/text-area.demo";
import { TextFieldDemo } from "@/components/ui/text-field.demo";
import { ToastDemo } from "@/components/ui/toast.demo";
import { ToggleDemo } from "@/components/ui/toggle.demo";
import { AudioNodeDemo } from "@/components/ui/node/audio-node.demo";
import { ExportNodeDemo } from "@/components/ui/node/export-node.demo";
import { StageNodeDemo } from "@/components/ui/node/stage-node.demo";
import { ShotNodeDemo } from "@/components/ui/node/shot-node.demo";
import { TooltipDemo } from "@/components/ui/tooltip.demo";

export type PlaybookCategory = "ui" | "icons";

export interface PlaybookEntry {
  id: string;
  name: string;
  category: PlaybookCategory;
  Demo: ComponentType;
}

export const PENCIL_REUSABLE_SYMBOL_COUNT = 113;
export const PENCIL_COMPONENT_FAMILY_COUNT = 35;
/**
 * Pencil 族之外的交互原语（如 ResizeHandle / Skeleton / Popover / SectionNav）
 * 计入 UI 登记总数。SectionNav 待 canvas.pen 有可用编辑器会话时补登记为
 * reusable symbol；在此之前只是代码侧的已注册组件。
 */
export const UI_COMPONENT_FAMILY_COUNT = 47;
export const PENCIL_CONSOLIDATION_NOTE =
  "当前登记 35 个已转译的应用组件族；其余 reusable symbols 属于上游 kit、变体或尚未进入 PurpleInk 公共边界的设计资产。";

/**
 * Track P 组件手册登记表。UI 分类只登记可追溯到 canvas.pen reusable symbol
 * 的组件族；Icons 分类是 Pencil A4 白名单目录，不是额外视觉原语。
 */
export const PLAYBOOK_ENTRIES: PlaybookEntry[] = [
  {
    id: "account-menu",
    name: "AccountMenu",
    category: "ui",
    Demo: AccountMenuDemo,
  },
  {
    id: "artifact-chip",
    name: "ArtifactChip",
    category: "ui",
    Demo: ArtifactChipDemo,
  },
  { id: "audio-node", name: "AudioNode", category: "ui", Demo: AudioNodeDemo },
  { id: "button", name: "Button", category: "ui", Demo: ButtonDemo },
  {
    id: "collapsible-card",
    name: "CollapsibleCard",
    category: "ui",
    Demo: CollapsibleCardDemo,
  },
  {
    id: "contact-sheet-thumb",
    name: "ContactSheetThumb",
    category: "ui",
    Demo: ContactSheetThumbDemo,
  },
  {
    id: "context-menu",
    name: "ContextMenu",
    category: "ui",
    Demo: ContextMenuDemo,
  },
  {
    id: "export-node",
    name: "ExportNode",
    category: "ui",
    Demo: ExportNodeDemo,
  },
  { id: "dialog", name: "Dialog", category: "ui", Demo: DialogDemo },
  {
    id: "hover-preview",
    name: "HoverPreview",
    category: "ui",
    Demo: HoverPreviewDemo,
  },
  { id: "popover", name: "Popover", category: "ui", Demo: PopoverDemo },
  {
    id: "human-check-field",
    name: "HumanCheckField",
    category: "ui",
    Demo: HumanCheckFieldDemo,
  },
  {
    id: "verification-code-field",
    name: "VerificationCodeField",
    category: "ui",
    Demo: VerificationCodeFieldDemo,
  },
  {
    id: "empty-state",
    name: "EmptyState",
    category: "ui",
    Demo: EmptyStateDemo,
  },
  {
    id: "icon-button",
    name: "IconButton",
    category: "ui",
    Demo: IconButtonDemo,
  },
  {
    id: "media-viewport",
    name: "MediaViewport",
    category: "ui",
    Demo: MediaViewportDemo,
  },
  { id: "nav-item", name: "NavItem", category: "ui", Demo: NavItemDemo },
  {
    id: "pipeline-node",
    name: "PipelineNode",
    category: "ui",
    Demo: PipelineNodeDemo,
  },
  {
    id: "sidebar",
    name: "PurpleInkSidebar",
    category: "ui",
    Demo: SidebarDemo,
  },
  {
    id: "sidebar-account",
    name: "SidebarAccount",
    category: "ui",
    Demo: SidebarAccountDemo,
  },
  {
    id: "sidebar-toggle",
    name: "SidebarToggle",
    category: "ui",
    Demo: SidebarToggleDemo,
  },
  { id: "top-bar", name: "TopBar", category: "ui", Demo: TopBarDemo },
  {
    id: "progress-bar",
    name: "ProgressBar",
    category: "ui",
    Demo: ProgressBarDemo,
  },
  {
    id: "project-card",
    name: "ProjectCard",
    category: "ui",
    Demo: ProjectCardDemo,
  },
  {
    id: "project-statistics-panel",
    name: "ProjectStatisticsPanel",
    category: "ui",
    Demo: ProjectStatisticsPanelDemo,
  },
  {
    id: "usage-trend-chart",
    name: "UsageTrendChart",
    category: "ui",
    Demo: UsageTrendChartDemo,
  },
  {
    id: "purple-ink-logo",
    name: "PurpleInkLogo",
    category: "ui",
    Demo: PurpleInkLogoDemo,
  },
  {
    id: "recent-projects-panel",
    name: "RecentProjectsPanel",
    category: "ui",
    Demo: RecentProjectsPanelDemo,
  },
  {
    id: "resize-handle",
    name: "ResizeHandle",
    category: "ui",
    Demo: ResizeHandleDemo,
  },
  {
    id: "queue-status-bar",
    name: "QueueStatusBar",
    category: "ui",
    Demo: QueueStatusBarDemo,
  },
  {
    id: "search-field",
    name: "SearchField",
    category: "ui",
    Demo: SearchFieldDemo,
  },
  {
    id: "section-nav",
    name: "SectionNav",
    category: "ui",
    Demo: SectionNavDemo,
  },
  {
    id: "segmented-control",
    name: "SegmentedControl",
    category: "ui",
    Demo: SegmentedControlDemo,
  },
  {
    id: "settings-group",
    name: "SettingsGroup",
    category: "ui",
    Demo: SettingsGroupDemo,
  },
  {
    id: "settings-panel",
    name: "SettingsPanel",
    category: "ui",
    Demo: SettingsPanelDemo,
  },
  {
    id: "settings-field",
    name: "SettingsField",
    category: "ui",
    Demo: SettingsFieldDemo,
  },
  {
    id: "settings-row",
    name: "SettingsRow",
    category: "ui",
    Demo: SettingsRowDemo,
  },
  { id: "skeleton", name: "Skeleton", category: "ui", Demo: SkeletonDemo },
  { id: "shot-node", name: "ShotNode", category: "ui", Demo: ShotNodeDemo },
  { id: "stage-node", name: "StageNode", category: "ui", Demo: StageNodeDemo },
  {
    id: "status-pill",
    name: "StatusPill",
    category: "ui",
    Demo: StatusPillDemo,
  },
  { id: "text-area", name: "TextArea", category: "ui", Demo: TextAreaDemo },
  { id: "text-field", name: "TextField", category: "ui", Demo: TextFieldDemo },
  {
    id: "timeline-track",
    name: "TimelineTrack",
    category: "ui",
    Demo: TimelineTrackDemo,
  },
  { id: "toast", name: "Toast", category: "ui", Demo: ToastDemo },
  { id: "toggle", name: "Toggle", category: "ui", Demo: ToggleDemo },
  { id: "tooltip", name: "Tooltip", category: "ui", Demo: TooltipDemo },
  {
    id: "lucide-catalog",
    name: "Lucide 白名单",
    category: "icons",
    Demo: LucideCatalogDemo,
  },
];

export function entriesByCategory(category: PlaybookCategory): PlaybookEntry[] {
  return PLAYBOOK_ENTRIES.filter((entry) => entry.category === category);
}
