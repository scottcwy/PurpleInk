import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createMetadata } from '@/lib/metadata'
import { redirectIfAuthenticated } from '@/features/auth/page-session'
import { SignupForm } from '../_components/signup-form'

export const metadata: Metadata = createMetadata({
  title: '创建 Workspace',
  description: '创建 PurpleInk 账号与 Workspace。',
  path: '/signup',
  noIndex: true,
})

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  await redirectIfAuthenticated(next)
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
