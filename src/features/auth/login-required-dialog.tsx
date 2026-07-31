'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { isUnauthenticatedError } from './unauthenticated-error'

/**
 * AI 动作的登录门（PLAN-002 §4.4）。
 *
 * `/products/*` 页面本身已由 proxy + withPageSession 拦住，本弹窗的真实价值在
 * 营销页入口（LaunchComposer）与「会话中途过期」两种场景：api 模块把 401 映射成
 * `UnauthenticatedError`，组件用 `handleAuthError` 识别后打开本弹窗，
 * 不各自 alert、不各自跳转。
 *
 * 回跳只带站内相对路径（`safeNextPath` 在登录侧再做白名单校验，双保险）。
 */
export function LoginRequiredDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const nextPath = pathname && pathname.startsWith('/') ? pathname : '/products/dashboard'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="需要登录"
      description="继续使用 AI 生成需要登录 PurpleInk 账号。"
      actions={
        <>
          <Button variant="gray" onClick={onClose}>
            暂不登录
          </Button>
          <Button onClick={() => router.push(`/login?next=${encodeURIComponent(nextPath)}`)}>
            去登录
          </Button>
        </>
      }
    >
      <p className="text-sm text-ds-text-muted">
        登录后你的项目、画布与生成产物只归属你自己的 Workspace；未登录状态不会创建任何数据。
      </p>
    </Dialog>
  )
}

/**
 * 调 AI 动作前的登录态判断 + 401 归一化处理。
 *
 * - `ensureLoggedIn()`：动作前查 `/api/auth/session`，未登录打开弹窗并返回 false
 *   （调用方必须中止请求）；
 * - `handleAuthError()`：catch 到 `UnauthenticatedError`（会话中途过期）时打开弹窗，
 *   返回是否已接管该错误。
 */
export function useRequireLogin() {
  const [loginRequired, setLoginRequired] = useState(false)

  const ensureLoggedIn = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })
      const body: unknown = await response.json()
      if (
        body &&
        typeof body === 'object' &&
        (body as { authenticated?: unknown }).authenticated === true
      ) {
        return true
      }
    } catch {
      // 登录态查询失败按未登录处理：弹窗引导，而不是放任后续请求 401。
    }
    setLoginRequired(true)
    return false
  }, [])

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (!isUnauthenticatedError(error)) return false
    setLoginRequired(true)
    return true
  }, [])

  const closeLoginDialog = useCallback(() => setLoginRequired(false), [])

  return { loginRequired, closeLoginDialog, ensureLoggedIn, handleAuthError }
}
