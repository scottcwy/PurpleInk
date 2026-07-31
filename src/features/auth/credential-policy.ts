import { z } from 'zod'

/**
 * 邮箱与口令规则的单一真值（与 `honeypot.ts` 同理单独成模块）：
 * 不引 `node:crypto`、不引 db schema，`'use client'` 组件可以安全 import。
 * 客户端实时校验与服务端 `schemas.ts` 都从这里取同一份 Zod 定义，
 * 不存在第二套字面规则。
 */

/** RFC 5321 的 path 上限。超长邮箱一律拒，避免把垃圾写进唯一索引。 */
const EMAIL_MAX_LENGTH = 254
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 200

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
