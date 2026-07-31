'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnimatedAside, DrawerOverlay } from './collapsible-panel'

export function AnimatedAsideDemo() {
  const [compact, setCompact] = useState(false)

  return (
    <div className="flex items-start gap-4">
      <AnimatedAside
        width={compact ? 88 : 240}
        className="h-32 rounded-lg border border-ds-border bg-glass-sidebar"
      >
        <div className="w-60 p-4 text-sm text-ds-text">
          <p className="font-semibold">流内侧栏</p>
          <p className="mt-2 text-ds-text-muted">宽度变化复用空间动效 token。</p>
        </div>
      </AnimatedAside>
      <Button variant="gray" onClick={() => setCompact((current) => !current)}>
        {compact ? '展开' : '收起'}
      </Button>
    </div>
  )
}

export function DrawerOverlayDemo() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-24 items-center justify-center">
      <Button onClick={() => setOpen(true)}>打开抽屉</Button>
      <DrawerOverlay
        open={open}
        onDismiss={() => setOpen(false)}
        side="right"
        scrimLabel="抽屉示例"
        className="w-[min(360px,calc(100vw-2rem))] border-l border-ds-border bg-ds-surface text-ds-text"
      >
        <div className="flex h-full flex-col p-6">
          <h3 className="text-lg font-semibold">DrawerOverlay</h3>
          <p className="mt-2 text-sm text-ds-text-muted">
            Escape、焦点约束、滚动锁与退出阶段均由 OverlayRoot 管理。
          </p>
          <div className="mt-auto flex justify-end">
            <Button onClick={() => setOpen(false)}>关闭抽屉</Button>
          </div>
        </div>
      </DrawerOverlay>
    </div>
  )
}
