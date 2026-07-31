import type { ReactNode } from 'react'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: ReactNode
  body?: ReactNode
}

export interface ToastOptions {
  duration?: number
}

export const DEFAULT_TOAST_DURATION = 5_000
const EMPTY_TOASTS: readonly ToastItem[] = []

let listeners: Array<() => void> = []
let toasts: readonly ToastItem[] = EMPTY_TOASTS
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

function notify() {
  listeners.forEach((listener) => listener())
}

function dismiss(id: string) {
  const timer = dismissTimers.get(id)
  if (timer) clearTimeout(timer)
  dismissTimers.delete(id)
  const next = toasts.filter((item) => item.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  notify()
}

/** 全局 Toast 调用入口；通知由根级 ToastViewport 负责展示。 */
export const toast = {
  show(
    variant: ToastVariant,
    title: ReactNode,
    body?: ReactNode,
    options: ToastOptions = {},
  ): string {
    const id = globalThis.crypto.randomUUID()
    toasts = [...toasts, { id, variant, title, body }]
    notify()

    const duration = options.duration ?? DEFAULT_TOAST_DURATION
    if (duration > 0) {
      dismissTimers.set(id, setTimeout(() => dismiss(id), duration))
    }
    return id
  },
  dismiss,
  subscribe(listener: () => void) {
    listeners = [...listeners, listener]
    return () => {
      listeners = listeners.filter((candidate) => candidate !== listener)
    }
  },
  getSnapshot(): readonly ToastItem[] {
    return toasts
  },
  getServerSnapshot(): readonly ToastItem[] {
    return EMPTY_TOASTS
  },
}
