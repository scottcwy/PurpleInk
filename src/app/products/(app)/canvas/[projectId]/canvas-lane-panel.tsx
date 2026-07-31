'use client'

import { Minimize2, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import {
  SPRING_SPATIAL_FAST,
  TRANSITION_BASE,
  TRANSITION_EXIT,
} from '@/lib/motion/tokens'
import { fadeInUp } from '@/lib/motion/variants'
import { LaneSummaryDetails, type LaneSummary } from './flow-elements'

export interface CanvasLanePanelProps {
  laneSummaries: LaneSummary[]
  collapsedLanes: Set<string>
  onToggle: (laneKey: string) => void
}

/** 画布左上分镜通道面板：整体可最小化为悬浮扳手圆钮，逐通道折叠与摘要展开。 */
export function CanvasLanePanel({
  laneSummaries,
  collapsedLanes,
  onToggle,
}: CanvasLanePanelProps) {
  const [minimized, setMinimized] = usePersistentToggle(
    'cvc:lane-panel-minimized',
    false,
  )

  if (minimized) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{
          opacity: 1,
          scale: 1,
          transition: { default: SPRING_SPATIAL_FAST, opacity: TRANSITION_BASE },
        }}
        className="absolute left-4 top-4 z-10"
      >
        <IconButton
          icon={Wrench}
          aria-label="展开分镜通道"
          title="展开分镜通道"
          className="size-10 rounded-full bg-ds-surface/90 shadow-[var(--ds-shadow)] backdrop-blur-xl"
          onClick={() => setMinimized(false)}
        />
      </motion.div>
    )
  }

  return (
    <motion.aside
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { default: SPRING_SPATIAL_FAST, opacity: TRANSITION_BASE },
      }}
      exit={{ opacity: 0, transition: TRANSITION_EXIT }}
      className="absolute left-4 top-4 max-h-[calc(100%-8rem)] w-56 overflow-auto rounded-md border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">
          分镜通道 · {laneSummaries.length}
        </p>
        <IconButton
          icon={Minimize2}
          aria-label="最小化分镜通道"
          title="最小化分镜通道"
          className="size-6 border-none bg-transparent shadow-none [&>svg]:size-3.5"
          onClick={() => setMinimized(true)}
        />
      </div>
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
    </motion.aside>
  )
}
