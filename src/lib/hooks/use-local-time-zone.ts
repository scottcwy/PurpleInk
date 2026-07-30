'use client'

import { useSyncExternalStore } from 'react'

export const SERVER_TIME_ZONE = 'UTC'

const subscribe = () => () => undefined
const getServerSnapshot = () => SERVER_TIME_ZONE
const getClientSnapshot = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || SERVER_TIME_ZONE

/**
 * hydration 首帧固定使用 UTC，完成后再切换为浏览器 IANA 时区。
 */
export function useLocalTimeZone(): string {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
