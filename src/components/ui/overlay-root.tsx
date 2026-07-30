'use client'

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import {
  completeOverlayPhase,
  isOverlayPresented,
  overlayAnimationTarget,
  resolveOverlayPhase,
  type OverlayAnimationTarget,
  type OverlayPhase,
} from './overlay-phase'
import {
  OVERLAY_SCRIM_VARIANTS,
  overlayContentVariants,
  type OverlayMotionPreset,
} from './overlay-motion'
import {
  useModalPlatform,
  useOpeningTrigger,
  usePopoverPlatform,
} from './overlay-platform'
import { useOverlayScrollLock } from './overlay-scroll-lock'
import { keepTabFocusInside } from './overlay-focus'

interface OverlayRootBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  preset?: OverlayMotionPreset
}

export interface ModalOverlayRootProps extends OverlayRootBaseProps {
  mode: 'modal'
  layoutClassName?: string
  ariaLabel?: string
  ariaLabelledBy?: string
}

export interface PopoverOverlayRootProps extends OverlayRootBaseProps {
  mode: 'popover'
  dismissal?: 'auto' | 'manual'
  role?: string
  ariaLabel?: string
}

export type OverlayRootProps = ModalOverlayRootProps | PopoverOverlayRootProps

export function OverlayRoot(props: OverlayRootProps) {
  const [state, setState] = useState<{
    requestedOpen: boolean
    phase: OverlayPhase
  }>(() => ({
    requestedOpen: props.open,
    phase: props.open ? 'opening' : 'closed',
  }))
  const phase =
    state.requestedOpen === props.open
      ? state.phase
      : resolveOverlayPhase(props.open, state.phase)
  if (state.requestedOpen !== props.open) {
    setState({ requestedOpen: props.open, phase })
  }

  const completeAnimation = useCallback((target: OverlayAnimationTarget) => {
    setState((current) => ({
      ...current,
      phase: completeOverlayPhase(current.phase, target),
    }))
  }, [])

  return props.mode === 'modal' ? (
    <ModalOverlaySurface
      {...props}
      phase={phase}
      onAnimationComplete={completeAnimation}
    />
  ) : (
    <PopoverOverlaySurface
      {...props}
      phase={phase}
      onAnimationComplete={completeAnimation}
    />
  )
}

interface SurfaceState {
  phase: OverlayPhase
  onAnimationComplete: (target: OverlayAnimationTarget) => void
}

function ModalOverlaySurface({
  open: _open,
  onOpenChange,
  children,
  className,
  layoutClassName,
  preset = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  phase,
  onAnimationComplete,
}: ModalOverlayRootProps & SurfaceState) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useOpeningTrigger(phase)
  const presented = isOverlayPresented(phase)
  const target = overlayAnimationTarget(phase)

  useModalPlatform(dialogRef, phase)
  useOverlayScrollLock(presented, triggerRef)

  return (
    <dialog
      ref={dialogRef}
      data-slot="overlay-root"
      data-overlay-mode="modal"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      tabIndex={-1}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none overflow-y-auto border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent"
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onKeyDown={(event) => keepTabFocusInside(event, event.currentTarget)}
    >
      <motion.div
        data-slot="overlay-scrim"
        className={cn(
          'flex min-h-full w-full justify-center bg-[color:var(--ds-scrim)] px-4 backdrop-blur-[20px]',
          layoutClassName,
        )}
        variants={OVERLAY_SCRIM_VARIANTS}
        initial="hidden"
        animate={target}
        onClick={(event) => {
          if (event.target === event.currentTarget) onOpenChange(false)
        }}
      >
        <motion.div
          data-slot="overlay-content"
          className={className}
          variants={overlayContentVariants(preset)}
          initial="hidden"
          animate={target}
          onAnimationComplete={(definition) => {
            if (definition === 'hidden' || definition === 'visible') {
              onAnimationComplete(definition)
            }
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </dialog>
  )
}

function PopoverOverlaySurface({
  open: _open,
  onOpenChange,
  children,
  className,
  preset = 'popover',
  dismissal = 'auto',
  role,
  ariaLabel,
  phase,
  onAnimationComplete,
}: PopoverOverlayRootProps & SurfaceState) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const target = overlayAnimationTarget(phase)
  const handlePlatformClose = useCallback(() => onOpenChange(false), [onOpenChange])

  usePopoverPlatform(popoverRef, phase, handlePlatformClose)

  return (
    <motion.div
      ref={popoverRef}
      popover={dismissal}
      data-slot="overlay-root"
      data-overlay-mode="popover"
      role={role}
      aria-label={ariaLabel}
      className={cn('m-0 border-0 bg-transparent p-0 text-inherit', className)}
      variants={overlayContentVariants(preset)}
      initial="hidden"
      animate={target}
      onAnimationComplete={(definition) => {
        if (definition === 'hidden' || definition === 'visible') {
          onAnimationComplete(definition)
        }
      }}
    >
      {children}
    </motion.div>
  )
}
