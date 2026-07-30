'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { fadeInUp } from '@/lib/motion/variants'
import { LaneSummaryDetails, type LaneSummary } from './flow-elements'

export interface CanvasLanePanelProps {
  laneSummaries: LaneSummary[]
  collapsedLanes: Set<string>
  onToggle: (laneKey: string) => void
}

/** 画布左上分镜通道面板：逐通道折叠与摘要展开。 */
export function CanvasLanePanel({
  laneSummaries,
  collapsedLanes,
  onToggle,
}: CanvasLanePanelProps) {
  return (
    <aside className="absolute left-4 top-4 max-h-[calc(100%-8rem)] w-56 overflow-auto rounded-md border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <p className="mb-2 text-xs font-semibold">
        分镜通道 · {laneSummaries.length}
      </p>
      <div className="space-y-2">
        {laneSummaries.map((summary) => {
          const collapsed = collapsedLanes.has(summary.laneKey)
          return (
            <div key={summary.laneKey}>
              <Button
                variant="gray"
                size="sm"
                aria-expanded={!collapsed}
                onClick={() => onToggle(summary.laneKey)}
                className="w-full justify-between"
              >
                <span className="truncate">{summary.laneKey}</span>
                <span className="text-ds-text-muted">
                  {collapsed ? '展开' : '折叠'}
                </span>
              </Button>
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div
                    key="summary"
                    variants={fadeInUp}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <LaneSummaryDetails summary={summary} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
