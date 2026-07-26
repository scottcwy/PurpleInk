'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { DemoAccount } from '@/features/auth/demo-account'

/**
 * 体验账号引导弹窗（路演 / 评审用）。
 *
 * 复用 `components/ui/dialog.tsx`，不新造浮层（AGENTS.md §3）。
 * 主操作是「填入并登录」——直接把凭据写进表单并提交，评委不需要手打；
 * 同时把邮箱与口令以可选中的文本呈现，方便他们自己复制或换设备登录。
 */
export function DemoAccountDialog({
  account,
  open,
  onClose,
  onFill,
}: {
  account: DemoAccount
  open: boolean
  onClose: () => void
  onFill: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="体验账号"
      description={account.note}
      actions={
        <>
          <Button variant="gray" onClick={onClose}>
            我自己输入
          </Button>
          <Button icon={Sparkles} onClick={onFill}>
            填入并登录
          </Button>
        </>
      }
    >
      <dl className="flex flex-col gap-2 rounded-md border border-ds-border bg-ds-surface-muted p-3.5">
        <Credential label="邮箱" value={account.email} />
        <Credential label="口令" value={account.password} />
      </dl>
      <p className="mt-3 text-xs leading-5 text-ds-text-muted">
        该账号已归属演示 Workspace，登录后看到的是真实入库的项目与产物，不是示例数据。
      </p>
    </Dialog>
  )
}

function Credential({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-8 shrink-0 text-[13px] text-ds-text-muted">{label}</dt>
      {/* `select-all` 让评委单击即可整段选中复制，不必精确拖选。 */}
      <dd className="min-w-0 flex-1 font-mono text-sm break-all text-ds-text select-all">
        {value}
      </dd>
    </div>
  )
}
