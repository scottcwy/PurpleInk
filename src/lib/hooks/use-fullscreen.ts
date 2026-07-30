'use client'

import { useCallback, useSyncExternalStore } from 'react'

export interface FullscreenControls {
  isFullscreen: boolean
  /** 浏览器是否允许全屏（iframe 未授权时为 false）。 */
  supported: boolean
  enter: (element: HTMLElement | null) => void
  exit: () => void
}

function subscribeFullscreen(onStoreChange: () => void) {
  document.addEventListener('fullscreenchange', onStoreChange)
  return () => document.removeEventListener('fullscreenchange', onStoreChange)
}

/** 能力探测无事件源，只需一次快照；订阅返回空清理函数。 */
const subscribeNever = () => () => undefined

/**
 * Fullscreen API 的受控封装。
 *
 * 状态从 `fullscreenchange` 订阅读取（useSyncExternalStore 而非 effect + setState），
 * 因此用户按 Esc 由浏览器退出时 UI 也会跟上；不支持时返回 `supported: false`，
 * 供调用方禁用入口而不是渲染点了没反应的按钮。
 */
export function useFullscreen(): FullscreenControls {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  )
  const supported = useSyncExternalStore(
    subscribeNever,
    () => document.fullscreenEnabled,
    () => false,
  )

  const enter = useCallback((element: HTMLElement | null) => {
    // requestFullscreen 在用户拒绝或环境禁止时 reject；状态仍由事件回填，此处只吞异常。
    void element?.requestFullscreen().catch(() => undefined)
  }, [])

  const exit = useCallback(() => {
    if (document.fullscreenElement === null) return
    void document.exitFullscreen().catch(() => undefined)
  }, [])

  return { isFullscreen, supported, enter, exit }
}
