import type { Metadata } from 'next'
import { createMetadata } from '@/lib/metadata'
import { AuthShellForm } from '../_components/auth-shell-form'

export const metadata: Metadata = createMetadata({
  title: '登录',
  description: '登录 PurpleInk Workspace。',
  path: '/login',
  noIndex: true,
})

export default function LoginPage() {
  return <AuthShellForm mode="login" />
}
