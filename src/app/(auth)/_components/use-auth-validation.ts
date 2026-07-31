'use client'

import { useCallback, useState } from 'react'
import { emailSchema, passwordSchema } from '@/features/auth/credential-policy'

export type AuthField = 'email' | 'password'

/**
 * 认证表单的客户端实时校验。
 *
 * 规则不在本地复制：直接跑 `credential-policy.ts` 的 Zod schema——与服务端
 * `schemas.ts` 是同一份定义，文案也取 schema 自带的 message。
 *
 * 节奏是「blur 报错、输入即清错」：打字过程中不打扰，离开字段才评判；
 * 一旦开始修正立刻撤下红字。纯客户端提示，不阻塞提交——真值仍在服务端，
 * 且这里只谈格式，不泄露账号存在性（PLAN-002 §3.4）。
 */
export function useAuthValidation() {
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({})

  const validate = useCallback((field: AuthField, value: string): string | undefined => {
    const schema = field === 'email' ? emailSchema : passwordSchema
    const result = schema.safeParse(value)
    if (result.success) return undefined
    if (field === 'email') return '邮箱格式不正确'
    return '密码至少 10 位，且需同时包含数字与非数字字符'
  }, [])

  const onBlur = useCallback(
    (field: AuthField, value: string) => {
      // 空值留给 required 与提交流程处理；blur 只评判已输入的内容。
      if (!value) return
      const message = validate(field, value)
      setErrors((prev) => {
        if (prev[field] === message) return prev
        return { ...prev, [field]: message }
      })
    },
    [validate],
  )

  const onChange = useCallback((field: AuthField) => {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  return {
    /** 每字段当前错误（未校验或已通过为 undefined）。 */
    errors,
    /** blur 时校验该字段；空值不评判。 */
    onBlur,
    /** 输入即清除该字段错误。 */
    onChange,
  }
}
