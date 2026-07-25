'use client'

import { useState } from 'react'
import { Button } from './button'
import { Dialog } from './dialog'

/** Dialog 交互示例（/playbook 展示单元）。 */
export function DialogDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开对话框</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="新建项目"
        description="粘贴你的文字稿，AI 将按语义自动拆分为分镜节点。"
        actions={
          <>
            <Button variant="gray" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setOpen(false)}>确认</Button>
          </>
        }
      >
        <div className="h-20" />
      </Dialog>
    </>
  )
}
