'use client'

import { useCallback, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import type { DemoAccount } from '@/features/auth/demo-account'
import { AuthFooterLink, AuthFormShell } from './auth-form-shell'
import { DemoAccountDialog } from './demo-account-dialog'
import { login } from './auth-api'

/**
 * 登录表单。
 *
 * 登录不挂人机验证：账密本身就有速率限制（`throttle.ts` 同邮箱 10 / 15 分钟），
 * 给每次正常登录都加一道算术题的成本远大于收益。超限后服务端回 429，
 * 前端如实呈现文案。
 *
 * `demoAccount` 非空时（由 `CVC_DEMO_ACCOUNT_*` 决定，默认关闭）额外挂一个
 * 体验账号引导弹窗，首次进入自动打开，供路演 / 评审使用。
 */
export function LoginForm({ demoAccount }: { demoAccount: DemoAccount | null }) {
  const router = useRouter()
  const nextParam = useSearchParams().get('next')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [demoOpen, setDemoOpen] = useState(Boolean(demoAccount))
  // 防重入：`submitting` 是异步生效的，快速双击会在同一渲染里进两次 submit。
  const submittingRef = useRef(false)

  const submit = useCallback(
    async (credentials: { email: string; password: string }) => {
      if (submittingRef.current) return
      submittingRef.current = true
      setSubmitting(true)
      setError(undefined)
      try {
        const { redirectTo } = await login({
          ...credentials,
          ...(nextParam ? { next: nextParam } : {}),
        })
        // 会话 cookie 由响应写入。`replace` 而不是 `push`：登录页不该留在返回栈里。
        router.replace(redirectTo)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '请稍后重试')
        setSubmitting(false)
        submittingRef.current = false
      }
    },
    [nextParam, router],
  )

  /**
   * 一键填入并登录。凭据同时写进表单 state（评委看得见填了什么）与直接传给
   * `submit`——不靠 state 落定后再提交，那需要一个 effect 来衔接，而在 effect
   * 里 setState 是被 `react-hooks/set-state-in-effect` 禁止的模式。
   */
  function fillDemoAccount() {
    if (!demoAccount) return
    setEmail(demoAccount.email)
    setPassword(demoAccount.password)
    setDemoOpen(false)
    void submit({ email: demoAccount.email, password: demoAccount.password })
  }

  return (
    <AuthFormShell
      title="登录 PurpleInk"
      description="使用注册邮箱与密码进入你的 Workspace。"
      footer={
        <>
          还没有账号？
          <AuthFooterLink
            href={nextParam ? `/signup?next=${encodeURIComponent(nextParam)}` : '/signup'}
          >
            创建账号
          </AuthFooterLink>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void submit({ email, password })
        }}
        noValidate
      >
        <TextField
          label="工作邮箱"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full"
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full"
        />
        <div className="flex items-center justify-between">
          {demoAccount ? (
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="focus-ring rounded-sm text-sm font-semibold text-ds-blue underline underline-offset-4"
            >
              查看体验账号
            </button>
          ) : (
            <span />
          )}
          <AuthFooterLink href="/password/reset">忘记密码？</AuthFooterLink>
        </div>
        {error && <Toast variant="error" title="登录失败" body={error} className="w-full" />}
        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? '登录中' : '登录'}
        </Button>
      </form>
      {demoAccount && (
        <DemoAccountDialog
          account={demoAccount}
          open={demoOpen}
          onClose={() => setDemoOpen(false)}
          onFill={fillDemoAccount}
        />
      )}
    </AuthFormShell>
  )
}
