'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { HumanCheckField } from '@/components/ui/human-check-field'
import { TextField } from '@/components/ui/text-field'
import { cn } from '@/lib/utils'
import { AuthFooterLink, AuthFormShell, HoneypotField } from './auth-form-shell'
import { FormFeedback } from './form-feedback'
import { SignupDetailsFields } from './signup-details-fields'
import { signup } from './auth-api'
import { useAuthValidation } from './use-auth-validation'
import { useVerificationCode } from './use-verification-code'

/**
 * 渐进披露容器（动效规范 §3 意图 4「折叠展开」的 CSS 实现）：
 * `grid-template-rows` 在 0fr ↔ 1fr 之间过渡，内层 `min-h-0 + overflow-hidden`
 * 让内容随行高一起被裁剪。内容**始终挂载**——折叠只是视觉收起，输入值与
 * 倒计时状态都保留；折叠态加 `aria-hidden` + `inert`，防止 Tab 与读屏
 * 落进不可见字段。
 *
 * 间距补偿：外层 `-mt-3/-mb-1` 抵消 form 的 `gap-4`，由裁剪区内的
 * `pt-3/pb-1` 补回——折叠时该区域不占一份间距，展开时间距随高度一起长出；
 * `-mx-1/px-1` 给字段 focus ring 留出裁剪余量，字段仍与外部对齐。
 */
function StageReveal({
  open,
  children,
  ref,
}: {
  open: boolean
  children: ReactNode
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cn(
        'grid transition-[grid-template-rows] duration-base ease-emphasized',
        '-mx-1 -mt-3 -mb-1',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div aria-hidden={!open} inert={!open} className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-4 px-1 pt-3 pb-1">{children}</div>
      </div>
    </div>
  )
}

/**
 * 注册表单。
 *
 * 流程刻意是两步同页：先「人机验证 + 邮箱 → 取码」，再「填码 + 资料 → 提交」。
 * 不做多步向导——中途换页会丢掉验证码倒计时与已通过的人机验证状态。
 * 阶段 2 由 `code.sent` 驱动渐进披露（不另设状态机）：取码成功前只露出
 * 邮箱 + 人机验证 + 取码按钮，降低初屏认知负荷；资料字段在 `StageReveal`
 * 里始终挂载，展开前后输入不丢。
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
  const validation = useAuthValidation()
  const detailsRef = useRef<HTMLDivElement>(null)
  const cooling = code.cooldownSeconds > 0

  // 展开阶段 2 时把焦点移到验证码输入：VerificationCodeField 不暴露 input
  // ref，从披露容器内按 `one-time-code` 语义定位；preventScroll 避免
  // 展开动画进行中触发滚动跳变。
  useEffect(() => {
    if (!code.sent) return
    detailsRef.current
      ?.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
      ?.focus({ preventScroll: true })
  }, [code.sent])

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
          error={validation.errors.email}
          hint={code.sent ? '验证码与该邮箱绑定；未收到可在下方重新发送。' : undefined}
          disabled={code.sent}
          onChange={(event) => {
            setEmail(event.target.value)
            validation.onChange('email')
          }}
          onBlur={(event) => validation.onBlur('email', event.target.value)}
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
        {/* 取码成功后本按钮收起，重发走阶段 2 里 VerificationCodeField 自带的
            「重新发送」（同一份冷却真值）；失败（如 429）不展开，倒计时
            以文本显示在按钮上，不只靠禁用态的视觉变化。 */}
        <StageReveal open={!code.sent}>
          <Button
            type="button"
            size="lg"
            loading={code.requesting}
            disabled={cooling || code.challengeLoading}
            onClick={() => void code.requestCode(email)}
            className="w-full"
          >
            {code.requesting
              ? '发送中'
              : cooling
                ? `${code.cooldownSeconds} 秒后可重试`
                : '获取验证码'}
          </Button>
        </StageReveal>
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
        <StageReveal open={code.sent} ref={detailsRef}>
          <SignupDetailsFields
            email={email}
            code={code}
            verificationCode={verificationCode}
            onVerificationCodeChange={setVerificationCode}
            name={name}
            onNameChange={setName}
            workspaceName={workspaceName}
            onWorkspaceNameChange={setWorkspaceName}
            password={password}
            onPasswordChange={setPassword}
            validation={validation}
            submitting={submitting}
          />
        </StageReveal>
        {error && (
          <FormFeedback
            variant="error"
            title="注册失败"
            body={error}
            onDismiss={() => setError(undefined)}
          />
        )}
      </form>
    </AuthFormShell>
  )
}
