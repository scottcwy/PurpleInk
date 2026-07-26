'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import { AuthFooterLink, AuthFormShell } from './auth-form-shell'
import { login } from './auth-api'

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      const { redirectTo } = await login({
        email,
        password,
        ...(nextParam ? { next: nextParam } : {}),
      })
      // 会话 cookie 由响应写入。`replace` 而不是 `push`：登录页不该留在返回栈里。
      router.replace(redirectTo)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell
      title="登录 PurpleInk"
      description="使用注册邮箱与密码进入你的 Workspace。"
      footer={
        <>
          还没有账号？
          <AuthFooterLink href={nextParam ? `/signup?next=${encodeURIComponent(nextParam)}` : '/signup'}>
            创建账号
          </AuthFooterLink>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
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
        <div className="flex justify-end">
          <AuthFooterLink href="/password/reset">忘记密码？</AuthFooterLink>
        </div>
        {error && <Toast variant="error" title="登录失败" body={error} className="w-full" />}
        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? '登录中' : '登录'}
        </Button>
      </form>
    </AuthFormShell>
  )
}
