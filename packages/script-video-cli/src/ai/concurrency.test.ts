import { describe, expect, it } from 'vitest'

import { mapWithConcurrency } from './concurrency'

describe('mapWithConcurrency', () => {
  it('never exceeds the configured active task limit', async () => {
    let active = 0
    let maximum = 0
    const result = await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      async (value) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return value * 2
      },
    )

    expect(maximum).toBe(3)
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
  })

  it('does not start new work after cancellation', async () => {
    const controller = new AbortController()
    let started = 0
    const promise = mapWithConcurrency(
      Array.from({ length: 8 }, (_, index) => index),
      2,
      async () => {
        started += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return true
      },
      { signal: controller.signal },
    )
    await new Promise((resolve) => setTimeout(resolve, 2))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBeLessThanOrEqual(2)
  })

  it('aborts sibling work and waits for it to settle after the first failure', async () => {
    let siblingAborted = false
    const startedAt = Date.now()

    await expect(
      mapWithConcurrency([0, 1], 2, async (value, _index, signal) => {
        if (value === 0) throw new Error('first failure')
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              siblingAborted = true
              resolve()
            },
            { once: true },
          )
        })
        return value
      }),
    ).rejects.toThrow('first failure')

    expect(siblingAborted).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
