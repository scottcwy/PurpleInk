import { FolderOpen, Pencil, Trash2 } from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/context-menu'

export interface ProjectMenuHandlers {
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}

/**
 * 项目右键菜单项：打开 / 重命名 / 删除。
 * 删除是 danger 项（图标 + red 双重语义），真正的二次确认由弹窗承担。
 */
export function buildProjectMenuItems(
  handlers: ProjectMenuHandlers,
): ContextMenuItem[] {
  return [
    { id: 'open', label: '打开', icon: FolderOpen, onSelect: handlers.onOpen },
    { id: 'rename', label: '重命名', icon: Pencil, onSelect: handlers.onRename },
    { type: 'separator', id: 'project-sep' },
    {
      id: 'delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      onSelect: handlers.onDelete,
    },
  ]
}
