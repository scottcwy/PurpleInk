'use client'

import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { VerificationCodeField } from '@/components/ui/verification-code-field'
import { PasswordStrengthMeter } from './password-strength-meter'
import type { useAuthValidation } from './use-auth-validation'
import type { VerificationCodeController } from './use-verification-code'

interface SignupDetailsFieldsProps {
  /** 验证码要发往的邮箱；重新发送沿用阶段 1 已锁定的地址，不另起流程。 */
  email: string
  code: VerificationCodeController
  verificationCode: string
  onVerificationCodeChange: (value: string) => void
  name: string
  onNameChange: (value: string) => void
  workspaceName: string
  onWorkspaceNameChange: (value: string) => void
  password: string
  onPasswordChange: (value: string) => void
  validation: ReturnType<typeof useAuthValidation>
  submitting: boolean
}

/**
 * 注册表单阶段 2 的字段组：验证码 + 资料 + 提交按钮。
 *
 * 纯呈现拆分：状态全部留在 `SignupForm`，这里只接 props——阶段 2 在折叠时
 * 也保持挂载（保住输入值与重发倒计时），字段本身不能持有会随卸载丢失的
 * 状态。提交按钮是 `type="submit"`，仍由外层 form 的 onSubmit 处理。
 */
export function SignupDetailsFields({
  email,
  code,
  verificationCode,
  onVerificationCodeChange,
  name,
  onNameChange,
  workspaceName,
  onWorkspaceNameChange,
  password,
  onPasswordChange,
  validation,
  submitting,
}: SignupDetailsFieldsProps) {
  return (
    <>
      <VerificationCodeField
        label="邮件验证码"
        placeholder="6 位数字"
        maxLength={6}
        value={verificationCode}
        onChange={(event) => onVerificationCodeChange(event.target.value)}
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
        onChange={(event) => onNameChange(event.target.value)}
        className="w-full"
      />
      <TextField
        label="Workspace 名称（可选）"
        autoComplete="organization"
        placeholder="留空则用「你的姓名 的 Workspace」"
        value={workspaceName}
        onChange={(event) => onWorkspaceNameChange(event.target.value)}
        className="w-full"
      />
      <TextField
        label="密码"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        error={validation.errors.password}
        hint="密码至少 10 位，需同时包含数字与非数字字符。"
        onChange={(event) => {
          onPasswordChange(event.target.value)
          validation.onChange('password')
        }}
        onBlur={(event) => validation.onBlur('password', event.target.value)}
        className="w-full"
      />
      <PasswordStrengthMeter password={password} />
      <Button type="submit" size="lg" loading={submitting} className="w-full">
        {submitting ? '创建中' : '创建账号并进入'}
      </Button>
    </>
  )
}
