'use client'

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
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
  style?: CSSProperties
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
}

export interface PopoverOverlayRootProps extends OverlayRootBaseProps {
  mode: 'popover'
  dismissal?: 'auto' | 'manual'
  role?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  id?: string
  style?: CSSProperties
  surfaceRef?: RefObject<HTMLDivElement | null>
  tabIndex?: number
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
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
    setState((current) => {
      const nextPhase = completeOverlayPhase(current.phase, target)
      return nextPhase === current.phase ? current : { ...current, phase: nextPhase }
    })
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
  style,
  preset = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
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
      aria-describedby={ariaDescribedBy}
      tabIndex={-1}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none overflow-y-auto border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent"
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onKeyDown={(event) => keepTabFocusInside(event, event.currentTarget)}
    >
      {/* closed 态不挂载内容：display:none 子树里的嵌套 modal 仍能 showModal()
          抢占 top layer，把可见弹窗连同全文档置为 inert（按钮全部失效）。
          closing 阶段保持挂载以播完退出动画。 */}
      {presented && (
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
            style={style}
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
      )}
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
  ariaDescribedBy,
  id,
  style,
  surfaceRef,
  tabIndex,
  onKeyDown,
  onContextMenu,
  onPointerEnter,
  onPointerLeave,
  phase,
  onAnimationComplete,
}: PopoverOverlayRootProps & SurfaceState) {
  const internalPopoverRef = useRef<HTMLDivElement>(null)
  const popoverRef = surfaceRef ?? internalPopoverRef
  const presented = isOverlayPresented(phase)
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
      aria-describedby={ariaDescribedBy}
      id={id}
      style={style}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
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
      {/* 同 modal：closed 态不挂载内容，防止闭合 popover 子树里的嵌套 modal 劫持 top layer。 */}
      {presented && children}
    </motion.div>
  )
}
