'use client'

import { VerificationCodeField } from './verification-code-field'

export function VerificationCodeFieldDemo() {
  return (
    <div className="flex w-[360px] max-w-full flex-col gap-4">
      <VerificationCodeField
        label="邮件验证码"
        placeholder="6 位数字"
        maxLength={6}
        onRequestCode={() => undefined}
      />
      <VerificationCodeField
        label="邮件验证码（冷却中）"
        placeholder="6 位数字"
        maxLength={6}
        sent
        cooldownSeconds={47}
        onRequestCode={() => undefined}
      />
    </div>
  )
}
