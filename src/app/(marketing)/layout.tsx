import { MarketingProviders } from '@/components/marketing/providers'
import type { ReactNode } from 'react'

export default function MarketingLayout({
  children,
}: {
  children: ReactNode
}): ReactNode {
  return <MarketingProviders>{children}</MarketingProviders>
}
