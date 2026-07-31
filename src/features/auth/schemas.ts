import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, emailSchema, passwordSchema } from './credential-policy'
import { HONEYPOT_FIELD_NAME } from './honeypot'
import { VERIFICATION_CODE_LENGTH } from './verification-code'

const NAME_MAX_LENGTH = 64
const WORKSPACE_NAME_MAX_LENGTH = 64

/**
 * 邮箱与口令规则本体在 `credential-policy.ts`（客户端安全，供实时校验复用），
 * 这里 re-export 以维持服务端消费方与测试的既有导入路径。
 */
export { emailSchema, passwordSchema }

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
  [HONEYPOT_FIELD_NAME]: z.string().max(256).optional(),
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
