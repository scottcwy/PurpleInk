import { z } from 'zod'
import { VERIFICATION_CODE_LENGTH } from './verification-code'

/** RFC 5321 的 path 上限。超长邮箱一律拒，避免把垃圾写进唯一索引。 */
const EMAIL_MAX_LENGTH = 254
const PASSWORD_MIN_LENGTH = 10
const PASSWORD_MAX_LENGTH = 200
const NAME_MAX_LENGTH = 64
const WORKSPACE_NAME_MAX_LENGTH = 64

/**
 * 邮箱统一小写 + 去空白后再进入任何逻辑，与 `users_email_lower_unique` 索引口径一致。
 * 这样「A@x.com」和「a@x.com」在校验、限流、验证码摘要三处都是同一个 key。
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, '邮箱过长')
  .pipe(z.string().regex(/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/, '邮箱格式不正确'))

/**
 * 口令强度：长度优先，字符类别只要求「不是纯一种类别」。
 * 强制符号会把用户推向 `Passw0rd!` 这类可预测口令，长度带来的熵更实在。
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, '密码过长')
  .refine(
    (value) => /\d/.test(value) && /[^\d]/.test(value),
    '密码需同时包含数字与非数字字符',
  )

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, '请填写姓名')
  .max(NAME_MAX_LENGTH, '姓名过长')

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, '请填写 Workspace 名称')
  .max(WORKSPACE_NAME_MAX_LENGTH, 'Workspace 名称过长')

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`), '验证码格式不正确')

/** 三道人机验证的表单载荷；蜜罐字段允许缺省（正常用户提交空串）。 */
export const humanCheckSchema = z.object({
  humanCheckToken: z.string().min(1).max(256),
  humanCheckAnswer: z.string().trim().max(16),
  contactReference: z.string().max(256).optional(),
})

export const requestVerificationCodeSchema = humanCheckSchema.extend({
  email: emailSchema,
})

export const signupSchema = z.object({
  email: emailSchema,
  name: displayNameSchema,
  workspaceName: workspaceNameSchema,
  password: passwordSchema,
  code: verificationCodeSchema,
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请填写密码').max(PASSWORD_MAX_LENGTH),
})

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
  password: passwordSchema,
})

export type RequestVerificationCodeInput = z.infer<typeof requestVerificationCodeSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
