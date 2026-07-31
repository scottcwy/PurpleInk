import { Film } from 'lucide-react'
import { MediaViewport } from './media-viewport'

export function MediaViewportDemo() {
  return (
    <MediaViewport className="max-w-xl">
      <div className="flex flex-col items-center gap-2 text-player-fg">
        <Film className="size-10" />
        <span className="text-xs">1920×1080 · 16:9 横屏媒体框</span>
      </div>
    </MediaViewport>
  )
}
