'use client'

import { ChevronRight, FileCode } from 'lucide-react'
import { useState, type PointerEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { IconButton } from '@/components/ui/icon-button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { DrawerOverlay } from '@/features/navigation/collapsible-panel'
import { TRANSITION_BASE, TRANSITION_INSTANT } from '@/lib/motion/tokens'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import {
  BP_SECONDARY_PANEL_COLLAPSE,
  SHOT_CODE_DEFAULT_WIDTH,
  SHOT_CODE_MAX_WIDTH,
  SHOT_CODE_MIN_WIDTH,
  SHOT_CONTRACT_DEFAULT_WIDTH,
  SHOT_CONTRACT_MAX_WIDTH,
  SHOT_CONTRACT_MIN_WIDTH,
} from '@/lib/layout/breakpoints'

export function useShotPanelState() {
  const autoCollapse = useMediaQuery(`(max-width: ${BP_SECONDARY_PANEL_COLLAPSE - 1}px)`)
  const veryNarrow = useMediaQuery('(max-width: 999px)')
  const [manualCodeCollapsed, setManualCodeCollapsed] = usePersistentToggle(
    'cvc:shot-code-collapsed',
    false,
  )
  const [manualContractCollapsed, setManualContractCollapsed] = usePersistentToggle(
    'cvc:shot-contract-collapsed',
    false,
  )
  const [codeOverlay, setCodeOverlay] = useState(false)
  const [contractOverlay, setContractOverlay] = useState(false)

  const code = useResizablePanel({
    storageKey: 'cvc:shot-code-width',
    defaultWidth: SHOT_CODE_DEFAULT_WIDTH,
    min: SHOT_CODE_MIN_WIDTH,
    max: SHOT_CODE_MAX_WIDTH,
    invert: true,
  })
  const contract = useResizablePanel({
    storageKey: 'cvc:shot-contract-width',
    defaultWidth: SHOT_CONTRACT_DEFAULT_WIDTH,
    min: SHOT_CONTRACT_MIN_WIDTH,
    max: SHOT_CONTRACT_MAX_WIDTH,
    invert: true,
  })

  const forceCodeCollapse = autoCollapse && veryNarrow
  const forceContractCollapse = autoCollapse
  const codeCollapsed = forceCodeCollapse || manualCodeCollapsed
  const contractCollapsed = forceContractCollapse || manualContractCollapsed

  return {
    code,
    contract,
    codeCollapsed,
    contractCollapsed,
    codeOverlay: codeCollapsed && codeOverlay,
    contractOverlay: contractCollapsed && contractOverlay,
    openCode() {
      if (forceCodeCollapse) setCodeOverlay(true)
      else setManualCodeCollapsed(false)
    },
    openContract() {
      if (forceContractCollapse) setContractOverlay(true)
      else setManualContractCollapsed(false)
    },
    closeCode() {
      setCodeOverlay(false)
      if (!forceCodeCollapse) setManualCodeCollapsed(true)
    },
    closeContract() {
      setContractOverlay(false)
      if (!forceContractCollapse) setManualContractCollapsed(true)
    },
    dismissCodeOverlay: () => setCodeOverlay(false),
    dismissContractOverlay: () => setContractOverlay(false),
  }
}

export function ShotPanelChrome({
  panels,
  codeContent,
  contractContent,
  player,
}: {
  panels: ReturnType<typeof useShotPanelState>
  codeContent: ReactNode
  contractContent: ReactNode
  player: ReactNode
}) {
  return (
    <section className="relative min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full min-h-0 gap-0 overflow-auto p-6">
        <div className="min-w-0 flex-1 pr-4">{player}</div>
        <AnimatedInlinePanel
          width={panels.code.width}
          collapsed={panels.codeCollapsed}
          dragging={panels.code.isDragging}
          onPointerDown={panels.code.handlePointerDown}
          onKeyAdjust={(delta) => panels.code.setWidth(panels.code.width - delta)}
          onCollapse={panels.closeCode}
          ariaLabel="调节代码列宽度"
          collapseLabel="收起代码列"
        >
          {codeContent}
        </AnimatedInlinePanel>
        <AnimatedInlinePanel
          width={panels.contract.width}
          collapsed={panels.contractCollapsed}
          dragging={panels.contract.isDragging}
          onPointerDown={panels.contract.handlePointerDown}
          onKeyAdjust={(delta) => panels.contract.setWidth(panels.contract.width - delta)}
          onCollapse={panels.closeContract}
          ariaLabel="调节合同列宽度"
          collapseLabel="收起合同列"
        >
          {contractContent}
        </AnimatedInlinePanel>
      </div>

      {(panels.codeCollapsed || panels.contractCollapsed) && (
        <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
          {panels.codeCollapsed && !panels.codeOverlay && (
            <IconButton
              icon={ChevronRight}
              aria-label="展开代码列"
              className="shadow-float [&>svg]:rotate-180"
              onClick={panels.openCode}
            />
          )}
          {panels.contractCollapsed && !panels.contractOverlay && (
            <IconButton
              icon={FileCode}
              aria-label="展开合同列"
              className="shadow-float"
              onClick={panels.openContract}
            />
          )}
        </div>
      )}

      <DrawerOverlay
        open={panels.codeOverlay}
        onDismiss={panels.dismissCodeOverlay}
        side="right"
        scrimLabel="关闭代码列遮罩"
        className="flex bg-surface"
        style={{ width: panels.code.width }}
      >
        <ResizeHandle
          isDragging={panels.code.isDragging}
          onPointerDown={panels.code.handlePointerDown}
          onKeyAdjust={(delta) => panels.code.setWidth(panels.code.width - delta)}
          aria-label="调节代码列宽度"
        />
        <div className="min-w-0 flex-1 overflow-auto p-4">{codeContent}</div>
      </DrawerOverlay>
      <DrawerOverlay
        open={panels.contractOverlay}
        onDismiss={panels.dismissContractOverlay}
        side="right"
        scrimLabel="关闭合同列遮罩"
        className="flex bg-surface"
        style={{ width: panels.contract.width }}
      >
        <ResizeHandle
          isDragging={panels.contract.isDragging}
          onPointerDown={panels.contract.handlePointerDown}
          onKeyAdjust={(delta) => panels.contract.setWidth(panels.contract.width - delta)}
          aria-label="调节合同列宽度"
        />
        <div className="min-w-0 flex-1 overflow-auto p-4">{contractContent}</div>
      </DrawerOverlay>
    </section>
  )
}

function AnimatedInlinePanel({
  children,
  width,
  collapsed,
  dragging,
  onPointerDown,
  onKeyAdjust,
  onCollapse,
  ariaLabel,
  collapseLabel,
}: {
  children: ReactNode
  width: number
  collapsed: boolean
  dragging: boolean
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onKeyAdjust: (delta: number) => void
  onCollapse: () => void
  ariaLabel: string
  collapseLabel: string
}) {
  return (
    <motion.div
      className="shrink-0 overflow-hidden"
      initial={false}
      animate={{ width: collapsed ? 0 : width }}
      transition={collapsed || !dragging ? TRANSITION_BASE : TRANSITION_INSTANT}
    >
      <div
        style={{ width }}
        className="relative flex h-full min-w-0 flex-col border-l border-separator pl-4"
      >
        {!collapsed && (
          <ResizeHandle
            className="absolute inset-y-0 left-0"
            isDragging={dragging}
            onPointerDown={onPointerDown}
            onKeyAdjust={onKeyAdjust}
            aria-label={ariaLabel}
          />
        )}
        <div className="mb-2 flex justify-end">
          <IconButton icon={ChevronRight} aria-label={collapseLabel} onClick={onCollapse} />
        </div>
        {children}
      </div>
    </motion.div>
  )
}
