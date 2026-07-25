'use client'

import { useState } from 'react'
import { Button } from './button'
import { Popover } from './popover'

/** Popover 交互示例（/playbook 展示单元）。 */
export function PopoverDemo() {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" onClick={() => setOpen((value) => !value)}>
          导出
        </Button>
      }
    >
      <p className="px-1 py-2 text-sm text-ds-text-muted">锚定在触发按钮下方的二次交互面板。</p>
      <Button size="sm" className="w-full" onClick={() => setOpen(false)}>
        开始导出
      </Button>
    </Popover>
  )
}
