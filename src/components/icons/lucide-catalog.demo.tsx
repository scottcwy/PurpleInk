import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  AudioLines,
  Captions,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  CircleX,
  Clapperboard,
  Download,
  Ellipsis,
  File,
  FileCheck,
  FileCode,
  FileInput,
  Film,
  Folder,
  Info,
  LayoutDashboard,
  LoaderCircle,
  Music,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Timer,
  TriangleAlert,
  Upload,
  Video,
  Volume2,
  Waypoints,
  X,
} from 'lucide-react'

const ICONS: ReadonlyArray<{ name: string; Icon: LucideIcon }> = [
  { name: 'clapperboard', Icon: Clapperboard },
  { name: 'layout-dashboard', Icon: LayoutDashboard },
  { name: 'folder', Icon: Folder },
  { name: 'waypoints', Icon: Waypoints },
  { name: 'settings', Icon: Settings },
  { name: 'search', Icon: Search },
  { name: 'plus', Icon: Plus },
  { name: 'circle-plus', Icon: CirclePlus },
  { name: 'x', Icon: X },
  { name: 'refresh-cw', Icon: RefreshCw },
  { name: 'download', Icon: Download },
  { name: 'upload', Icon: Upload },
  { name: 'sparkles', Icon: Sparkles },
  { name: 'ellipsis', Icon: Ellipsis },
  { name: 'chevron-right', Icon: ChevronRight },
  { name: 'arrow-left', Icon: ArrowLeft },
  { name: 'play', Icon: Play },
  { name: 'skip-back', Icon: SkipBack },
  { name: 'skip-forward', Icon: SkipForward },
  { name: 'volume-2', Icon: Volume2 },
  { name: 'loader-circle', Icon: LoaderCircle },
  { name: 'film', Icon: Film },
  { name: 'file', Icon: File },
  { name: 'file-input', Icon: FileInput },
  { name: 'file-check', Icon: FileCheck },
  { name: 'file-code', Icon: FileCode },
  { name: 'video', Icon: Video },
  { name: 'audio-lines', Icon: AudioLines },
  { name: 'music', Icon: Music },
  { name: 'captions', Icon: Captions },
  { name: 'palette', Icon: Palette },
  { name: 'info', Icon: Info },
  { name: 'circle-check', Icon: CircleCheck },
  { name: 'triangle-alert', Icon: TriangleAlert },
  { name: 'circle-x', Icon: CircleX },
  { name: 'shield-check', Icon: ShieldCheck },
  { name: 'timer', Icon: Timer },
] as const

/** canvas.pen A4 与设计清单 §6.2 的 Lucide 白名单。 */
export function LucideCatalogDemo() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {ICONS.map(({ name, Icon }) => (
        <div key={name} className="flex items-center gap-2 rounded-sm bg-fill px-3 py-2">
          <Icon className="h-4 w-4 text-label-secondary" aria-hidden="true" />
          <code className="text-xs text-label">{name}</code>
        </div>
      ))}
    </div>
  )
}
