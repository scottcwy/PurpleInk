import type { Metadata } from 'next'
import { createMetadata } from '@/lib/metadata'
import { AuthShellForm } from '../_components/auth-shell-form'

export const metadata: Metadata = createMetadata({
  title: '创建 Workspace',
  description: '创建 PurpleInk 账号与 Workspace。',
  path: '/signup',
  noIndex: true,
})

export default function SignupPage() {
  return <AuthShellForm mode="signup" />
}
