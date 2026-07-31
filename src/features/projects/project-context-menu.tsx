'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from '@/components/ui/context-menu'
import {
  LoginRequiredDialog,
  useRequireLogin,
} from '@/features/auth/login-required-dialog'
import { productCanvasHref } from '@/features/navigation/products-routes'
import { buildProjectMenuItems } from './project-menu-items'
import { ProjectDeleteDialog, ProjectRenameDialog } from './project-mutation-dialogs'

export interface ProjectMenuItem {
  id: string
  title: string
}

export interface ProjectContextMenuHandlers {
  /** 重命名成功后的本地收敛（避免整表重拉）。 */
  onRenamed: (projectId: string, title: string) => void
  onDeleted: (projectId: string) => void
}

export interface ProjectContextMenuBinding {
  /** 绑到卡片 / 表格行的 onContextMenu。 */
  openMenu: (event: MouseEvent, item: ProjectMenuItem) => void
  /** 菜单与两个弹窗；由调用方渲染一次。 */
  overlay: ReactNode
}

/**
 * 项目右键菜单：打开 / 重命名 / 删除（删除带二次确认）。
 *
 * 网格卡片与列表行共用本 hook，保证两条渲染路径行为一致。
 */
export function useProjectContextMenu(
  handlers: ProjectContextMenuHandlers,
): ProjectContextMenuBinding {
  const router = useRouter()
  const [target, setTarget] = useState<{
    item: ProjectMenuItem
    position: ContextMenuPosition
  } | null>(null)
  const [renaming, setRenaming] = useState<ProjectMenuItem | null>(null)
  const [deleting, setDeleting] = useState<ProjectMenuItem | null>(null)
  const { loginRequired, closeLoginDialog, handleAuthError } = useRequireLogin()

  const openMenu = useCallback((event: MouseEvent, item: ProjectMenuItem) => {
    event.preventDefault()
    setTarget({ item, position: { x: event.clientX, y: event.clientY } })
  }, [])

  const closeMenu = useCallback(() => setTarget(null), [])

  const items: ContextMenuItem[] = target
    ? buildProjectMenuItems({
        onOpen: () => router.push(productCanvasHref(target.item.id)),
        onRename: () => setRenaming(target.item),
        onDelete: () => setDeleting(target.item),
      })
    : []

  return {
    openMenu,
    overlay: (
      <>
        <ContextMenu
          open={target !== null}
          position={target?.position ?? null}
          items={items}
          ariaLabel="项目操作"
          onClose={closeMenu}
        />
        {renaming && (
          <ProjectRenameDialog
            project={renaming}
            onClose={() => setRenaming(null)}
            onRenamed={handlers.onRenamed}
            onAuthError={handleAuthError}
          />
        )}
        {deleting && (
          <ProjectDeleteDialog
            project={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={handlers.onDeleted}
            onAuthError={handleAuthError}
          />
        )}
        <LoginRequiredDialog open={loginRequired} onClose={closeLoginDialog} />
      </>
    ),
  }
}

