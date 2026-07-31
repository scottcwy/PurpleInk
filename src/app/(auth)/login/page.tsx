import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createMetadata } from '@/lib/metadata'
import { redirectIfAuthenticated } from '@/features/auth/page-session'
import { LoginForm } from '../_components/login-form'

export const metadata: Metadata = createMetadata({
  title: '登录',
  description: '登录 PurpleInk Workspace。',
  path: '/login',
  noIndex: true,
})

/**
 * `proxy.ts` 只按 cookie 形状拦，已登录判定要查库，因此这里再做一次
 * （`routing.md` §9.2：已登录访问 `/login` → 302 `/products/dashboard`）。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  await redirectIfAuthenticated(next)
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
