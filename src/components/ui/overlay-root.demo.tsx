'use client'

import { useState } from 'react'
import { Button } from './button'
import { OverlayRoot } from './overlay-root'

export function OverlayRootDemo() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-24 items-center justify-center">
      <Button onClick={() => setOpen(true)}>打开内核示例</Button>
      <OverlayRoot
        mode="modal"
        open={open}
        onOpenChange={setOpen}
        layoutClassName="items-center py-8"
        ariaLabel="OverlayRoot 内核示例"
        className="w-[min(420px,calc(100vw-2rem))] rounded-[10px] border border-ds-border bg-ds-surface p-6 text-ds-text shadow-[var(--ds-shadow)]"
      >
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">平台 top layer</h3>
            <p className="mt-1 text-sm text-ds-text-muted">
              Escape、焦点约束与背景 inert 由原生 dialog 提供。
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setOpen(false)}>关闭</Button>
          </div>
        </div>
      </OverlayRoot>
    </div>
  )
}
