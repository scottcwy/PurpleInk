'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import type { AdminUserRow } from '../user-admin'

interface PageData {
  items: AdminUserRow[]
  total: number
  page: number
  pageSize: number
}

export function AdminUsersPanel({
  page,
  actorUserId,
}: {
  page: PageData
  actorUserId: string
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [disabling, setDisabling] = useState<AdminUserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function mutate(url: string, init: RequestInit): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'content-type': 'application/json', ...init.headers },
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readError(result))
      setCreating(false)
      setEditing(null)
      setDisabling(null)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void mutate('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: form.get('email'),
        name: form.get('name'),
        password: form.get('password'),
        workspaceName: form.get('workspaceName'),
      }),
    })
  }

  function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    void mutate(`/api/admin/users/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ email: form.get('email'), name: form.get('name') }),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <CardTitle>全部账号</CardTitle>
          <CardBody>{page.total} 个真实 PostgreSQL 账号</CardBody>
        </div>
        <Button icon={UserPlus} onClick={() => { setError(null); setCreating(true) }}>
          创建账号
        </Button>
      </Card>
      {error && (
        <p role="alert" className="rounded-md border border-ds-red/30 bg-ds-red-soft px-4 py-3 text-sm text-ds-red">
          {error}
        </p>
      )}
      {page.items.length === 0 ? (
        <Card className="flex justify-center"><EmptyState icon={Users} title="暂无账号" /></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ds-border bg-ds-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-ds-surface-muted text-xs text-ds-text-muted">
              <tr>
                <Header>账号</Header><Header>角色</Header><Header>状态</Header>
                <Header>Workspace / 会话</Header><Header>创建时间</Header><Header>操作</Header>
              </tr>
            </thead>
            <tbody>
              {page.items.map((user) => (
                <tr key={user.id} className="border-t border-ds-border">
                  <Cell><strong className="block font-medium">{user.name}</strong><span className="text-xs text-ds-text-muted">{user.email}</span></Cell>
                  <Cell>{user.role === 'admin' ? '平台管理员' : '普通用户'}</Cell>
                  <Cell><StatusPill variant={user.status === 'active' ? 'rendered' : 'stale'} label={user.status === 'active' ? '活跃' : '已停用'} /></Cell>
                  <Cell>{user.workspaceCount} / {user.activeSessionCount}</Cell>
                  <Cell className="font-mono text-xs text-ds-text-muted">{formatDate(user.createdAt)}</Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="gray" onClick={() => { setError(null); setEditing(user) }}>编辑</Button>
                      {user.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={user.id === actorUserId}
                          onClick={() => { setError(null); setDisabling(user) }}
                        >停用</Button>
                      ) : (
                        <Button size="sm" variant="tinted" onClick={() => void mutate(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })}>恢复</Button>
                      )}
                    </div>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="创建账号"
        description="账号、Workspace、owner 成员关系与 Free 权益将在一个事务内创建。"
      >
        <form className="flex flex-col gap-4" onSubmit={create}>
          <TextField name="email" type="email" label="邮箱" required autoComplete="off" />
          <TextField name="name" label="姓名" required />
          <TextField name="workspaceName" label="Workspace 名称" required />
          <TextField name="password" type="password" label="初始密码" required autoComplete="new-password" />
          <div className="flex justify-end gap-2"><Button type="button" variant="gray" onClick={() => setCreating(false)}>取消</Button><Button type="submit" loading={busy}>创建</Button></div>
        </form>
      </Dialog>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="编辑账号" description="仅更新邮箱与显示名称；角色由服务端 CLI 单独管理。">
        {editing && (
          <form className="flex flex-col gap-4" onSubmit={edit}>
            <TextField name="email" type="email" label="邮箱" required defaultValue={editing.email} />
            <TextField name="name" label="姓名" required defaultValue={editing.name} />
            <div className="flex justify-end gap-2"><Button type="button" variant="gray" onClick={() => setEditing(null)}>取消</Button><Button type="submit" loading={busy}>保存</Button></div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={disabling !== null}
        onClose={() => setDisabling(null)}
        title="确认停用账号"
        description={`将停用 ${disabling?.email ?? ''} 并立即注销其全部会话；Workspace、项目、账本和产物不会删除。`}
        actions={<><Button variant="gray" onClick={() => setDisabling(null)}>取消</Button><Button variant="destructive" loading={busy} onClick={() => disabling && void mutate(`/api/admin/users/${disabling.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation: 'DISABLE' }) })}>确认停用</Button></>}
      />
    </div>
  )
}

function Header({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}

function readError(value: unknown): string {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
    ? value.error
    : '操作失败，请稍后重试'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}
