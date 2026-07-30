'use client'

import Link from 'next/link'
import { Clock, Download, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BillingCanvasUsage } from '@/features/billing/ui/usage-panels'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import { productExportHref } from '@/features/navigation/products-routes'

export interface CanvasExecutionAction {
  mode: 'start' | 'stop' | 'busy' | 'download'
  label: string
}

export function CanvasExecutionActions({
  action,
  billing,
  projectId,
  submitting,
  websiteProject,
  onToggle,
}: {
  action: CanvasExecutionAction
  billing: BillingUiProjection
  projectId: string
  submitting: boolean
  websiteProject: boolean
  onToggle: () => void
}) {
  return (
    <>
      <BillingCanvasUsage projection={billing} />
      {action.mode === 'download' ? (
        <Link href={productExportHref(projectId)}>
          <Button size="sm" icon={Download}>{action.label}</Button>
        </Link>
      ) : (
        <Button
          variant="gray"
          size="sm"
          icon={
            action.mode === 'busy'
              ? Clock
              : action.mode === 'stop'
                ? Square
                : Play
          }
          disabled={submitting || action.mode === 'busy'}
          onClick={onToggle}
        >
          {action.label}
        </Button>
      )}
      {!websiteProject && (
        <Link href={productExportHref(projectId)}>
          <Button size="sm" icon={Download}>导出 MP4</Button>
        </Link>
      )}
    </>
  )
}
