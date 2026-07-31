'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  SPRING_SPATIAL_DEFAULT,
  TRANSITION_BASE,
  TRANSITION_EXIT,
} from '@/lib/motion/tokens'
import { Toast } from './toast'
import { toast } from './toast-store'

const TOAST_ENTER = {
  x: SPRING_SPATIAL_DEFAULT,
  opacity: TRANSITION_BASE,
}

const subscribePortalTarget = () => () => undefined
const getPortalTarget = () => document.body
const getServerPortalTarget = () => null

export function ToastViewport() {
  const portalTarget = useSyncExternalStore(
    subscribePortalTarget,
    getPortalTarget,
    getServerPortalTarget,
  )
  const items = useSyncExternalStore(
    toast.subscribe,
    toast.getSnapshot,
    toast.getServerSnapshot,
  )

  if (!portalTarget) return null

  return createPortal(
    <aside
      aria-label="通知"
      aria-live="polite"
      aria-relevant="additions removals"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-3"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            className="pointer-events-auto max-w-full"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0, transition: TOAST_ENTER }}
            exit={{ opacity: 0, x: 24, transition: TRANSITION_EXIT }}
          >
            <Toast
              variant={item.variant}
              title={item.title}
              body={item.body}
              onClose={() => toast.dismiss(item.id)}
              className="max-w-full"
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </aside>,
    portalTarget,
  )
}
