import { describe, expect, it } from 'vitest'

import { concurrencyDefaults } from '../local-config'
import { ConcurrencyChannels } from './channels'

describe('ConcurrencyChannels', () => {
  it('limits a shared channel while preserving overlapping execution', async () => {
    const channels = new ConcurrencyChannels({ ...concurrencyDefaults, text: 2 })
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        channels.run('text', async () => {
          await new Promise((done) => setTimeout(done, 12 + index))
        }),
      ),
    )
    const snapshot = channels.snapshot()
    expect(snapshot.peaks.text).toBe(2)
    expect(snapshot.spans).toHaveLength(5)
    const [first, second] = snapshot.spans
    expect(new Date(second!.startedAt).getTime()).toBeLessThanOrEqual(new Date(first!.finishedAt).getTime())
  })
})
