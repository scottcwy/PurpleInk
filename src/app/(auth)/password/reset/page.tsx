import type { Metadata } from 'next'
import { createMetadata } from '@/lib/metadata'
import { redirectIfAuthenticated } from '@/features/auth/page-session'
import { ResetPasswordForm } from '../../_components/reset-password-form'

export const metadata: Metadata = createMetadata({
  title: '重置密码',
  description: '通过邮件验证码重置 PurpleInk 账号密码。',
  path: '/password/reset',
  noIndex: true,
})

export default async function ResetPasswordPage() {
  await redirectIfAuthenticated()
  return <ResetPasswordForm />
}
