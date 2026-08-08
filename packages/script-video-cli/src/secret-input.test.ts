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

  it('settles safely on terminal error and restores all terminal state', async () => {
    const terminal = new FakeTerminal({ paused: true, flowing: false, raw: false })
    const result = createProcessSecretInput(asReadable(terminal), outputSink()).readHidden()

    expect(() => terminal.fail(new Error('private terminal detail'))).not.toThrow()

    await expect(result).rejects.toMatchObject({ code: 'KEY_INPUT_FAILED' })
    await expect(result).rejects.not.toThrow(/private terminal detail/u)
    expectRestored(terminal)
  })

  it.each(['end', 'close'] as const)('settles safely on terminal %s and restores all state', async (event) => {
    const terminal = new FakeTerminal({ paused: true, flowing: false, raw: false })
    const result = createProcessSecretInput(asReadable(terminal), outputSink()).readHidden()

    terminal.emit(event)

    await expect(settleWithin(result)).resolves.toEqual({ status: 'rejected', code: 'KEY_INPUT_INTERRUPTED' })
    expectRestored(terminal)
  })

  it('settles once on Ctrl+C and uses the same cleanup path', async () => {
    const terminal = new FakeTerminal({ paused: true, flowing: false, raw: false })
    const result = createProcessSecretInput(asReadable(terminal), outputSink()).readHidden()

    terminal.send('\u0003')
    terminal.emit('close')

    await expect(result).rejects.toMatchObject({ code: 'KEY_INPUT_CANCELLED' })
    expectRestored(terminal)
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

  fail(error: Error): void {
    this.emit('error', error)
  }

  totalInputListeners(): number {
    return (
      this.listenerCount('data') + this.listenerCount('error') + this.listenerCount('end') + this.listenerCount('close')
    )
  }
}

function asReadable(terminal: FakeTerminal): NodeJS.ReadableStream {
  return terminal as unknown as NodeJS.ReadableStream
}

function outputSink(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream
}

function expectRestored(terminal: FakeTerminal): void {
  expect(terminal.isRaw).toBe(false)
  expect(terminal.isPaused()).toBe(true)
  expect(terminal.readableFlowing).toBe(false)
  expect(terminal.totalInputListeners()).toBe(0)
}

async function settleWithin(promise: Promise<string>): Promise<{ status: string; code?: string }> {
  return Promise.race([
    promise.then(
      () => ({ status: 'resolved' }),
      (error: unknown) => ({
        status: 'rejected',
        code: isRecord(error) && typeof error.code === 'string' ? error.code : undefined,
      }),
    ),
    new Promise<{ status: string }>((resolve) => setTimeout(() => resolve({ status: 'pending' }), 25)),
  ])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
