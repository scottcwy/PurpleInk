'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { HumanCheckField } from '@/components/ui/human-check-field'
import { TextField } from '@/components/ui/text-field'
import { VerificationCodeField } from '@/components/ui/verification-code-field'
import { AuthFooterLink, AuthFormShell, HoneypotField } from './auth-form-shell'
import { FormFeedback } from './form-feedback'
import { signup } from './auth-api'
import { useVerificationCode } from './use-verification-code'

/**
 * 注册表单。
 *
 * 流程刻意是两步同页：先「人机验证 + 邮箱 → 取码」，再「填码 + 资料 → 提交」。
 * 不做多步向导——中途换页会丢掉验证码倒计时与已通过的人机验证状态。
 *
 * 注册成功即建立会话（服务端在同一事务里创建 user + workspace + owner 成员关系），
 * 因此这里直接跳应用，不再要求用户登录一次。
 */
export function SignupForm() {
  const router = useRouter()
  const nextParam = useSearchParams().get('next')
  const code = useVerificationCode('signup')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      const { redirectTo } = await signup({
        email,
        name,
        workspaceName: workspaceName.trim() || `${name.trim()} 的 Workspace`,
        password,
        code: verificationCode,
        ...(nextParam ? { next: nextParam } : {}),
      })
      router.replace(redirectTo)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell
      title="创建 Workspace"
      description="注册后会创建你的账号与一个独立 Workspace，项目与产物只属于你。"
      footer={
        <>
          已有账号？
          <AuthFooterLink href={nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : '/login'}>
            前往登录
          </AuthFooterLink>
        </>
      }
    >
      <form className="relative flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <HoneypotField value={code.honeypot} onChange={code.setHoneypot} />
        <TextField
          label="工作邮箱"
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
          label="姓名"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full"
        />
        <TextField
          label="Workspace 名称（可选）"
          autoComplete="organization"
          placeholder="留空则用「你的姓名 的 Workspace」"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          className="w-full"
        />
        <TextField
          label="密码"
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
            title="注册失败"
            body={error}
            onDismiss={() => setError(undefined)}
          />
        )}
        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? '创建中' : '创建账号并进入'}
        </Button>
      </form>
    </AuthFormShell>
  )
}
