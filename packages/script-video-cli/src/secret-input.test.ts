import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { createProcessSecretInput } from './secret-input'

describe('hidden terminal secret input', () => {
  it('restores a paused terminal and stops the flow it started', async () => {
    const terminal = new FakeTerminal({ paused: true, flowing: false, raw: false })
    const reader = createProcessSecretInput(asReadable(terminal), outputSink())

    const result = reader.readHidden()
    expect(terminal.isRaw).toBe(true)
    terminal.send('synthetic-secret\r')

    await expect(result).resolves.toBe('synthetic-secret')
    expect(terminal.isRaw).toBe(false)
    expect(terminal.isPaused()).toBe(true)
    expect(terminal.readableFlowing).toBe(false)
    expect(terminal.resumeCalls).toBe(1)
    expect(terminal.pauseCalls).toBe(1)
    expect(terminal.listenerCount('data')).toBe(0)
  })

  it('keeps an already flowing raw terminal in its original state', async () => {
    const terminal = new FakeTerminal({ paused: false, flowing: true, raw: true })
    const reader = createProcessSecretInput(asReadable(terminal), outputSink())

    const result = reader.readHidden()
    terminal.send('another-synthetic-secret\n')

    await expect(result).resolves.toBe('another-synthetic-secret')
    expect(terminal.isRaw).toBe(true)
    expect(terminal.isPaused()).toBe(false)
    expect(terminal.readableFlowing).toBe(true)
    expect(terminal.resumeCalls).toBe(0)
    expect(terminal.pauseCalls).toBe(0)
    expect(terminal.listenerCount('data')).toBe(0)
  })
})

class FakeTerminal extends EventEmitter {
  readonly isTTY = true
  isRaw: boolean
  readableFlowing: boolean | null
  resumeCalls = 0
  pauseCalls = 0
  private paused: boolean

  constructor(state: { paused: boolean; flowing: boolean | null; raw: boolean }) {
    super()
    this.paused = state.paused
    this.readableFlowing = state.flowing
    this.isRaw = state.raw
  }

  isPaused(): boolean {
    return this.paused
  }

  setRawMode(value: boolean): this {
    this.isRaw = value
    return this
  }

  resume(): this {
    this.resumeCalls += 1
    this.paused = false
    this.readableFlowing = true
    return this
  }

  pause(): this {
    this.pauseCalls += 1
    this.paused = true
    this.readableFlowing = false
    return this
  }

  send(value: string): void {
    this.emit('data', Buffer.from(value, 'utf8'))
  }
}

function asReadable(terminal: FakeTerminal): NodeJS.ReadableStream {
  return terminal as unknown as NodeJS.ReadableStream
}

function outputSink(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream
}
