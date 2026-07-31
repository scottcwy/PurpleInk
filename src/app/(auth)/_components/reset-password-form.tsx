'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { HumanCheckField } from '@/components/ui/human-check-field'
import { TextField } from '@/components/ui/text-field'
import { VerificationCodeField } from '@/components/ui/verification-code-field'
import { AuthFooterLink, AuthFormShell, HoneypotField } from './auth-form-shell'
import { FormFeedback } from './form-feedback'
import { resetPassword } from './auth-api'
import { useVerificationCode } from './use-verification-code'

/**
 * 重置密码表单。与注册页共用同一外壳与同一套验证码控制器（§4.1）。
 *
 * 不使用重置链接：验证码通道已经存在，再加一套一次性链接就是第二套真值。
 * 重置成功会失效该用户全部旧会话，并为当前请求签发新会话，因此直接进应用。
 */
export function ResetPasswordForm() {
  const router = useRouter()
  const code = useVerificationCode('password_reset')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      const { redirectTo } = await resetPassword({
        email,
        code: verificationCode,
        password,
      })
      router.replace(redirectTo)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell
      title="重置密码"
      description="用注册邮箱接收验证码，设置新密码后其他设备上的登录会全部失效。"
      footer={
        <>
          想起密码了？
          <AuthFooterLink href="/login">返回登录</AuthFooterLink>
        </>
      }
    >
      <form className="relative flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <HoneypotField value={code.honeypot} onChange={code.setHoneypot} />
        <TextField
          label="注册邮箱"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full"
        />
        <HumanCheckField
          label="人机验证"
          question={code.challenge?.question ?? ''}
          svg={code.challenge?.svg}
          placeholder="填写计算结果"
          value={code.answer}
          onChange={(event) => code.setAnswer(event.target.value)}
          onRefresh={code.refreshChallenge}
          refreshing={code.challengeLoading}
          disabled={submitting}
        />
        <VerificationCodeField
          label="邮件验证码"
          placeholder="6 位数字"
          maxLength={6}
          value={verificationCode}
          onChange={(event) => setVerificationCode(event.target.value)}
          onRequestCode={() => void code.requestCode(email)}
          cooldownSeconds={code.cooldownSeconds}
          requesting={code.requesting}
          sent={code.sent}
          disabled={submitting}
        />
        <TextField
          label="新密码"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full"
        />
        <p className="text-xs text-ds-text-muted">密码至少 10 位，需同时包含数字与非数字字符。</p>
        {code.notice && !code.error && (
          <FormFeedback
            variant="info"
            title="验证码已发送"
            body={code.notice}
            onDismiss={code.clearFeedback}
          />
        )}
        {code.error && (
          <FormFeedback
            variant="error"
            title="验证码发送失败"
            body={code.error}
            onDismiss={code.clearFeedback}
          />
        )}
        {error && (
          <FormFeedback
            variant="error"
            title="重置失败"
            body={error}
            onDismiss={() => setError(undefined)}
          />
        )}
        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? '提交中' : '设置新密码并登录'}
        </Button>
      </form>
    </AuthFormShell>
  )
}
