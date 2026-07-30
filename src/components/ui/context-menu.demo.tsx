'use client'

import { CircleSlash, Maximize2, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'
import { ContextMenu, type ContextMenuItem } from './context-menu'
import type { ContextMenuPosition } from './context-menu-placement'

/**
 * ContextMenu 交互示例（/playbook 展示单元）。
 * 三组菜单项均为演示 fixture，不代表任何真实业务状态。
 */
export function ContextMenuDemo() {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null)

  const items: ContextMenuItem[] = [
    {
      id: 'rerender',
      label: '重新渲染',
      icon: RefreshCw,
      onSelect: () => undefined,
    },
    {
      id: 'stop',
      label: '停止',
      icon: CircleSlash,
      disabled: true,
      disabledReason: '演示禁用态',
      onSelect: () => undefined,
    },
    { type: 'separator', id: 'sep' },
    {
      id: 'fullscreen',
      label: '全屏模式',
      icon: Maximize2,
      onSelect: () => undefined,
    },
    {
      id: 'delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      onSelect: () => undefined,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div
        className="ds-dot-grid flex h-32 items-center justify-center rounded-lg border border-dashed border-ds-border text-[13px] text-ds-text-muted"
        onContextMenu={(event) => {
          event.preventDefault()
          setPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        在此区域右键唤出菜单（演示数据）
      </div>
      <Button
        variant="gray"
        size="sm"
        className="self-start"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPosition({ x: rect.left, y: rect.bottom })
        }}
      >
        键盘 / 触屏也可从按钮唤出
      </Button>
      <ContextMenu
        open={position !== null}
        position={position}
        items={items}
        ariaLabel="演示上下文菜单"
        onClose={() => setPosition(null)}
      />
    </div>
  )
}
