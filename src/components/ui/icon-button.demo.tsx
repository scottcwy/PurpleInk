import { X } from 'lucide-react'
import { IconButton } from './icon-button'

export function IconButtonDemo() {
  return (
    <div className="flex items-center gap-3">
      <IconButton icon={X} aria-label="关闭" />
    </div>
  )
}
