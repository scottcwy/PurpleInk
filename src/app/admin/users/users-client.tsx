'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'

/**
 * 用户管理客户端：列表（搜索/分页）+ 新建弹窗 + 行内操作（启停/改角色/重置
 * 口令/删除，均二次确认）。所有请求走 withAdminSession API——非 admin 404，
 * 会话失效由 401 引导回登录。
 */

interface AdminUserRow {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  role: 'user' | 'admin'
  createdAt: string
  lastSeenAt: string | null
}

interface UserListData {
  users: AdminUserRow[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 20

type PendingAction =
  | { kind: 'create' }
  | { kind: 'reset-password'; user: AdminUserRow }
  | { kind: 'toggle-status'; user: AdminUserRow }
  | { kind: 'toggle-role'; user: AdminUserRow }
  | { kind: 'delete'; user: AdminUserRow }

export function UsersClient() {
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<UserListData | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (appliedQuery) params.set('q', appliedQuery)
      const response = await fetch(`/api/admin/users?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData((await response.json()) as UserListData & { ok: true })
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [page, appliedQuery])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">用户管理</h1>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setAppliedQuery(query.trim())
            }}
          >
            <SearchField
              placeholder="搜索邮箱或姓名，回车确认"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          <Button variant="gray" size="md" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
          <Button size="md" icon={Plus} onClick={() => setAction({ kind: 'create' })}>
            新建用户
          </Button>
        </div>
      </div>

      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
              <th className="px-5 py-3 font-medium">邮箱</th>
              <th className="px-3 py-3 font-medium">姓名</th>
              <th className="px-3 py-3 font-medium">角色</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">注册时间</th>
              <th className="px-3 py-3 font-medium">最近活跃</th>
              <th className="px-5 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((user) => (
              <tr key={user.id} className="border-b border-ds-border/60 last:border-b-0">
                <td className="px-5 py-3">{user.email}</td>
                <td className="px-3 py-3">{user.name}</td>
                <td className="px-3 py-3">
                  <StatusPill
                    variant={user.role === 'admin' ? 'generating' : 'pending'}
                    label={user.role === 'admin' ? '管理员' : '普通用户'}
                  />
                </td>
                <td className="px-3 py-3">
                  <StatusPill
                    variant={user.status === 'active' ? 'rendered' : 'failed'}
                    label={user.status === 'active' ? '正常' : '已禁用'}
                  />
                </td>
                <td className="px-3 py-3 text-ds-text-muted">{formatTime(user.createdAt)}</td>
                <td className="px-3 py-3 text-ds-text-muted">{formatTime(user.lastSeenAt)}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="gray"
                      size="sm"
                      onClick={() => setAction({ kind: 'toggle-status', user })}
                    >
                      {user.status === 'active' ? '禁用' : '启用'}
                    </Button>
                    <Button
                      variant="gray"
                      size="sm"
                      onClick={() => setAction({ kind: 'toggle-role', user })}
                    >
                      {user.role === 'admin' ? '降为用户' : '设为管理员'}
                    </Button>
                    <Button
                      variant="gray"
                      size="sm"
                      onClick={() => setAction({ kind: 'reset-password', user })}
                    >
                      重置口令
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setAction({ kind: 'delete', user })}
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && (data?.users.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-ds-text-muted">
                  {listError ? `加载失败：${listError}` : '没有匹配的用户'}
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-ds-text-muted">
                  加载中…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-[13px] text-ds-text-muted">
        <span>共 {data?.total ?? 0} 个用户</span>
        <div className="flex items-center gap-2">
          <Button
            variant="gray"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
          >
            上一页
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="gray"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {action?.kind === 'create' && (
        <CreateUserDialog
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            void load()
          }}
        />
      )}
      {action?.kind === 'reset-password' && (
        <ResetPasswordDialog
          user={action.user}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            void load()
          }}
        />
      )}
      {(action?.kind === 'toggle-status' ||
        action?.kind === 'toggle-role' ||
        action?.kind === 'delete') && (
        <ConfirmActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

/** 统一读取 API 错误正文（{ok:false,error} 或纯状态码）。 */
async function requestJson(input: string, init: RequestInit): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(input, init)
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (response.ok && body?.ok) return { ok: true }
    return { ok: false, error: body?.error ?? `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function CreateUserDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await requestJson('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password, role }),
    })
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.error)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="新建用户"
      description="管理端建号跳过邮箱验证码，创建后即可登录。"
      actions={
        <>
          <Button variant="gray" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="邮箱"
          type="email"
          className="w-full"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="姓名"
          className="w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="初始口令"
          type="password"
          className="w-full"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-medium">角色</span>
          <SegmentedControl
            options={[
              { value: 'user', label: '普通用户' },
              { value: 'admin', label: '管理员' },
            ]}
            value={role}
            onChange={setRole}
          />
        </div>
        {error && <p className="text-[13px] text-ds-red">{error}</p>}
      </div>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserRow
  onClose: () => void
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await requestJson(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.error)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="重置口令"
      description={`为 ${user.email} 设置新口令，其现有会话将全部下线。`}
      actions={
        <>
          <Button variant="gray" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? '提交中…' : '重置'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="新口令"
          type="password"
          className="w-full"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="text-[13px] text-ds-red">{error}</p>}
      </div>
    </Dialog>
  )
}

function ConfirmActionDialog({
  action,
  onClose,
  onDone,
}: {
  action: Extract<PendingAction, { kind: 'toggle-status' | 'toggle-role' | 'delete' }>
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = action

  const plan =
    action.kind === 'delete'
      ? {
          title: '删除用户',
          description: `将永久删除 ${user.email} 及其会话，此操作不可撤销。`,
          confirmLabel: '删除',
          destructive: true,
          request: { method: 'DELETE' as const, body: undefined as string | undefined },
        }
      : action.kind === 'toggle-status'
        ? user.status === 'active'
          ? {
              title: '禁用用户',
              description: `禁用后 ${user.email} 将被立即踢下线且无法登录。`,
              confirmLabel: '禁用',
              destructive: true,
              request: { method: 'PATCH' as const, body: JSON.stringify({ status: 'disabled' }) },
            }
          : {
              title: '启用用户',
              description: `恢复 ${user.email} 的登录能力。`,
              confirmLabel: '启用',
              destructive: false,
              request: { method: 'PATCH' as const, body: JSON.stringify({ status: 'active' }) },
            }
        : user.role === 'admin'
          ? {
              title: '降为普通用户',
              description: `${user.email} 将失去管理后台访问权限。`,
              confirmLabel: '降级',
              destructive: true,
              request: { method: 'PATCH' as const, body: JSON.stringify({ role: 'user' }) },
            }
          : {
              title: '设为管理员',
              description: `${user.email} 将获得管理后台的全部权限。`,
              confirmLabel: '设为管理员',
              destructive: false,
              request: { method: 'PATCH' as const, body: JSON.stringify({ role: 'admin' }) },
            }

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await requestJson(`/api/admin/users/${user.id}`, {
      method: plan.request.method,
      ...(plan.request.body
        ? { headers: { 'Content-Type': 'application/json' }, body: plan.request.body }
        : {}),
    })
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.error)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={plan.title}
      description={plan.description}
      actions={
        <>
          <Button variant="gray" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant={plan.destructive ? 'destructive' : 'primary'}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '提交中…' : plan.confirmLabel}
          </Button>
        </>
      }
    >
      {error && <p className="text-[13px] text-ds-red">{error}</p>}
    </Dialog>
  )
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
