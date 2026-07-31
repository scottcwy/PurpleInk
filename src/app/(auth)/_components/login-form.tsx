'use client'

import { useCallback, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { AuthFooterLink, AuthFormShell } from './auth-form-shell'
import { FormFeedback } from './form-feedback'
import { login } from './auth-api'
import { useAuthValidation } from './use-auth-validation'

/**
 * 登录表单。
 *
 * 登录不挂人机验证：账密本身就有速率限制（`throttle.ts` 同邮箱 10 / 15 分钟），
 * 给每次正常登录都加一道算术题的成本远大于收益。超限后服务端回 429，
 * 前端如实呈现文案。
 */
export function LoginForm() {
  const router = useRouter()
  const nextParam = useSearchParams().get('next')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  // 登录页只校验邮箱格式：密码规则不适用于存量账号（loginSchema 也不复检强度）。
  const validation = useAuthValidation()
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
          error={validation.errors.email}
          onChange={(event) => {
            setEmail(event.target.value)
            validation.onChange('email')
          }}
          onBlur={(event) => validation.onBlur('email', event.target.value)}
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
        <div className="flex items-center justify-end">
          <AuthFooterLink href="/password/reset">忘记密码？</AuthFooterLink>
        </div>
        {error && (
          <FormFeedback
            variant="error"
            title="登录失败"
            body={error}
            onDismiss={() => setError(undefined)}
          />
        )}
        <Button type="submit" size="lg" loading={submitting} className="w-full">
          {submitting ? '登录中' : '登录'}
        </Button>
      </form>
    </AuthFormShell>
  )
}
