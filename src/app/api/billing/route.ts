import { NextResponse } from 'next/server'
import { getBillingProjection } from '@/features/billing'
import { withApiSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

export function GET(): Promise<Response> {
  return withApiSession(async () =>
    NextResponse.json(await getBillingProjection()),
  )
}
