'use client'

import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { OverlayPhase } from './overlay-phase'

export function useOpeningTrigger(phase: OverlayPhase) {
  const triggerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (phase !== 'opening' || triggerRef.current) return
    const active = document.activeElement
    triggerRef.current = active instanceof HTMLElement ? active : null
  }, [phase])
  useLayoutEffect(() => {
    if (phase !== 'closed') return
    triggerRef.current = null
  }, [phase])
  return triggerRef
}

export function useModalPlatform(
  dialogRef: RefObject<HTMLDialogElement | null>,
  phase: OverlayPhase,
) {
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (phase !== 'closed' && !dialog.open) dialog.showModal()
    if (phase === 'closed' && dialog.open) dialog.close()
  }, [dialogRef, phase])
}

export function usePopoverPlatform(
  popoverRef: RefObject<HTMLDivElement | null>,
  phase: OverlayPhase,
  onPlatformClose: () => void,
) {
  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    if (phase !== 'closed' && !popover.matches(':popover-open')) popover.showPopover()
    if (phase === 'closed' && popover.matches(':popover-open')) popover.hidePopover()
  }, [phase, popoverRef])

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    function handleToggle(event: Event) {
      if ((event as ToggleEvent).newState === 'closed' && phase !== 'closed') {
        onPlatformClose()
      }
    }
    popover.addEventListener('toggle', handleToggle)
    return () => popover.removeEventListener('toggle', handleToggle)
  }, [onPlatformClose, phase, popoverRef])
}
