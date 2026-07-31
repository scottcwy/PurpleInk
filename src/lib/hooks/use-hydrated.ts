'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => undefined
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * 服务端与客户端 hydration 首帧均返回 false，hydration 完成后切为 true。
 * 用于隔离只能从浏览器取得、且会改变可见 HTML 的状态。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
