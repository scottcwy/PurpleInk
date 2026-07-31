import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOAST_DURATION, toast } from './toast-store'

const createdIds: string[] = []

afterEach(() => {
  createdIds.splice(0).forEach((id) => toast.dismiss(id))
  vi.useRealTimers()
})

describe('toast store', () => {
  it('publishes multiple notifications and supports explicit dismissal', () => {
    const listener = vi.fn()
    const unsubscribe = toast.subscribe(listener)
    createdIds.push(
      toast.show('info', '第一条', undefined, { duration: 0 }),
      toast.show('success', '第二条', undefined, { duration: 0 }),
    )

    expect(toast.getSnapshot().map(({ title }) => title)).toEqual(['第一条', '第二条'])
    toast.dismiss(createdIds[0])
    expect(toast.getSnapshot().map(({ title }) => title)).toEqual(['第二条'])
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('automatically dismisses after the default duration', () => {
    vi.useFakeTimers()
    const id = toast.show('warning', '即将自动关闭')
    createdIds.push(id)

    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION - 1)
    expect(toast.getSnapshot().some((item) => item.id === id)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(toast.getSnapshot().some((item) => item.id === id)).toBe(false)
  })
})
