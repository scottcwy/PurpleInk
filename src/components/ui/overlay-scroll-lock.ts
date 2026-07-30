'use client'

import { useLayoutEffect, type RefObject } from 'react'

interface ScrollLockState {
  count: number
  overflow: string
  overscrollBehavior: string
}

const scrollLocks = new WeakMap<HTMLElement, ScrollLockState>()

function findScrollRoot(trigger: HTMLElement | null): HTMLElement {
  const appScrollRoot = trigger?.closest<HTMLElement>('[data-overlay-scroll-root]')
  const documentScrollRoot = document.scrollingElement
  return appScrollRoot ??
    (documentScrollRoot instanceof HTMLElement ? documentScrollRoot : document.body)
}

function lockScroll(root: HTMLElement) {
  const current = scrollLocks.get(root)
  if (current) {
    current.count += 1
    return
  }
  scrollLocks.set(root, {
    count: 1,
    overflow: root.style.overflow,
    overscrollBehavior: root.style.overscrollBehavior,
  })
  root.style.overflow = 'hidden'
  root.style.overscrollBehavior = 'contain'
}

function unlockScroll(root: HTMLElement) {
  const current = scrollLocks.get(root)
  if (!current) return
  current.count -= 1
  if (current.count > 0) return
  root.style.overflow = current.overflow
  root.style.overscrollBehavior = current.overscrollBehavior
  scrollLocks.delete(root)
}

export function useOverlayScrollLock(
  active: boolean,
  triggerRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!active) return
    const root = findScrollRoot(triggerRef.current)
    lockScroll(root)
    return () => unlockScroll(root)
  }, [active, triggerRef])
}
