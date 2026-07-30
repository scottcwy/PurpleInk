'use client'

import { TriangleAlert } from 'lucide-react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { ContactSheetThumb } from '@/components/ui/contact-sheet-thumb'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import {
  blockingIssueLabel,
  type ExportReadiness,
} from './export-readiness-contract'

export interface ExportQaProps {
  laneKeys: string[]
  readiness?: ExportReadiness
  error?: string
}

/** Final QA 抽帧审查：全宽置于管线时间线下方。 */
export function ExportQa({ laneKeys, readiness, error }: ExportQaProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3 px-4 pb-6 sm:px-6">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Final QA · 抽帧审查</h2>
        <p className="text-xs text-ds-text-muted">25% / 60% / 95% 三态联系表</p>
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {laneKeys.map((laneKey) => (
          <ContactSheetThumb
            key={laneKey}
            label={laneKey}
            checked={readiness?.shotQa[laneKey] ?? undefined}
          />
        ))}
      </div>
      {!readiness && !error && (
        <div className="flex items-center gap-2">
          <Skeleton circle className="h-3.5 w-3.5" />
          <Skeleton className="h-3 w-40" />
        </div>
      )}
      {!readiness?.ready && readiness && (
        <>
          <p className="flex items-center gap-2 text-xs text-ds-text-muted">
            <TriangleAlert className="size-3.5 text-ds-amber" />
            未完成分镜
          </p>
          <div className="flex max-h-20 flex-wrap gap-2 overflow-auto">
            {readiness.incompleteNodeIds.map((id) => (
              <ArtifactChip key={id} filename={id} />
            ))}
            {readiness.blockingIssues.map((issue) => {
              const label = blockingIssueLabel(issue)
              return (
                <ArtifactChip
                  key={`${String(issue.laneKey)}-${issue.kind}`}
                  filename={label}
                />
              )
            })}
            {readiness.waivedQaLanes.map((laneKey) => (
              <ArtifactChip key={`waived-${laneKey}`} filename={`${laneKey} · 未验收`} />
            ))}
          </div>
        </>
      )}
      {error && <Toast variant="error" title="失败" body={error} />}
    </section>
  )
}
