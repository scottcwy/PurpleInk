import type { AiClient } from '../ai/openai-compatible'
import type { ConcurrencyConfig } from '../local-config'

export type ChannelName = keyof ConcurrencyConfig

interface ChannelSpan {
  channel: ChannelName
  startedAt: string
  finishedAt: string
}

class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiting.shift()?.()
  }
}

export class ConcurrencyChannels {
  private readonly semaphores: Record<ChannelName, Semaphore>
  private readonly active: Record<ChannelName, number>
  private readonly peaks: Record<ChannelName, number>
  private readonly spans: ChannelSpan[] = []

  constructor(readonly limits: ConcurrencyConfig) {
    this.semaphores = createRecord((name) => new Semaphore(limits[name]))
    this.active = createRecord(() => 0)
    this.peaks = createRecord(() => 0)
  }

  async run<T>(channel: ChannelName, work: () => Promise<T>): Promise<T> {
    return this.semaphores[channel].run(async () => {
      const startedAt = new Date().toISOString()
      this.active[channel] += 1
      this.peaks[channel] = Math.max(this.peaks[channel], this.active[channel])
      try {
        return await work()
      } finally {
        this.active[channel] -= 1
        this.spans.push({ channel, startedAt, finishedAt: new Date().toISOString() })
      }
    })
  }

  wrapAi(ai: AiClient): AiClient {
    return {
      completeText: (input) => this.run('text', () => ai.completeText(input)),
      completeJson: (input) => this.run('text', () => ai.completeJson(input)),
    }
  }

  snapshot(): { limits: ConcurrencyConfig; peaks: Record<ChannelName, number>; spans: ChannelSpan[] } {
    return { limits: { ...this.limits }, peaks: { ...this.peaks }, spans: [...this.spans] }
  }
}

const channelNames: ChannelName[] = ['run', 'text', 'browser', 'tts', 'asr', 'render']

function createRecord<T>(factory: (name: ChannelName) => T): Record<ChannelName, T> {
  return Object.fromEntries(channelNames.map((name) => [name, factory(name)])) as Record<ChannelName, T>
}
