import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDpapiProcessRunner, WindowsCurrentUserDpapiProtector, type DpapiProcessRequest } from './dpapi'

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('WindowsCurrentUserDpapiProtector', () => {
  it('uses an absolute trusted System32 executable, safe cwd, and stdin-only secret', async () => {
    const systemRoot = 'C:\\TrustedWindows'
    const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const requests: DpapiProcessRequest[] = []
    const protector = new WindowsCurrentUserDpapiProtector({
      platform: 'win32',
      systemRoot,
      pathExists: (path: string) => path === executable,
      runner: async (request: DpapiProcessRequest) => {
        requests.push(request)
        return Buffer.from('sealed-bytes', 'utf8').toString('base64')
      },
    })

    await expect(protector.protect('synthetic-stdin-secret')).resolves.toEqual(Buffer.from('sealed-bytes'))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      executable,
      stdin: 'synthetic-stdin-secret',
      cwd: dirname(executable),
      timeoutMs: 5_000,
      maxOutputBytes: 1024 * 1024,
    })
    expect(requests[0]?.args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      expect.stringMatching(/^[a-z0-9+/=]+$/iu),
    ])
    expect(requests[0]?.args.join(' ')).not.toContain('synthetic-stdin-secret')
  })

  it('checks Sysnative before System32 and rejects an unresolvable system executable', async () => {
    const systemRoot = 'C:\\TrustedWindows'
    const sysnative = join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const requests: DpapiProcessRequest[] = []
    const protector = new WindowsCurrentUserDpapiProtector({
      platform: 'win32',
      systemRoot,
      pathExists: (path: string) => path === sysnative,
      runner: async (request: DpapiProcessRequest) => {
        requests.push(request)
        return Buffer.from('sealed', 'utf8').toString('base64')
      },
    })

    await protector.protect('synthetic')
    expect(requests[0]?.executable).toBe(sysnative)

    const missing = new WindowsCurrentUserDpapiProtector({
      platform: 'win32',
      systemRoot,
      pathExists: () => false,
      runner: async () => {
        throw new Error('runner must not start')
      },
    })
    await expect(missing.protect('synthetic')).rejects.toMatchObject({ code: 'DPAPI_UNAVAILABLE' })
  })

  it('passes an invocation to the process without shell or stderr capture', async () => {
    const child = new FakeChildProcess()
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: Record<string, unknown> }> = []
    const runner = createProcessRunner((executable, args, options) => {
      spawnCalls.push({ executable, args, options })
      return child
    })
    const request = processRequest()

    const result = runner(request)
    child.stdout.emit('data', Buffer.from('result', 'utf8'))
    child.emit('close', 0)

    await expect(result).resolves.toBe('result')
    expect(spawnCalls).toEqual([
      {
        executable: request.executable,
        args: request.args,
        options: {
          cwd: request.cwd,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      },
    ])
    expect(child.stdin.endedValue).toBe(request.stdin)
    expect(child.totalListenerCount()).toBe(0)
  })

  it.each([
    ['spawn error', (child: FakeChildProcess) => child.emit('error', new Error('private spawn detail'))],
    ['stdin error', (child: FakeChildProcess) => child.stdin.emit('error', new Error('private stdin detail'))],
    ['non-zero exit', (child: FakeChildProcess) => child.emit('close', 7)],
  ])('settles once and removes resources after %s', async (_label, fail) => {
    const child = new FakeChildProcess()
    const runner = createProcessRunner(() => child)
    const result = runner(processRequest())

    fail(child)
    child.emit('close', 1)

    await expect(result).rejects.toMatchObject({ code: 'DPAPI_FAILED' })
    expect(child.totalListenerCount()).toBe(0)
  })

  it('kills and cleans a timed-out process exactly once', async () => {
    const child = new FakeChildProcess({ closeOnKill: true })
    const runner = createProcessRunner(() => child)

    await expect(runner({ ...processRequest(), timeoutMs: 5 })).rejects.toMatchObject({ code: 'DPAPI_FAILED' })
    expect(child.killCalls).toBe(1)
    expect(child.totalListenerCount()).toBe(0)
  })

  it('kills oversized output and rejects invalid base64 without exposing process output', async () => {
    const child = new FakeChildProcess({ closeOnKill: true })
    const runner = createProcessRunner(() => child)
    const result = runner({ ...processRequest(), maxOutputBytes: 3 })
    child.stdout.emit('data', Buffer.from('four', 'utf8'))

    await expect(result).rejects.toMatchObject({ code: 'DPAPI_FAILED' })
    expect(child.killCalls).toBe(1)
    expect(child.totalListenerCount()).toBe(0)

    const protector = new WindowsCurrentUserDpapiProtector({
      platform: 'win32',
      systemRoot: 'C:\\TrustedWindows',
      pathExists: () => true,
      runner: async () => 'not-valid-base64!',
    })
    await expect(protector.protect('synthetic')).rejects.toMatchObject({ code: 'DPAPI_FAILED' })
  })

  windowsIt('round-trips a synthetic secret through the real CurrentUser DPAPI', async () => {
    const protector = new WindowsCurrentUserDpapiProtector()
    const plainText = `purpleink-dpapi-roundtrip-${randomUUID()}`

    const protectedBytes = await protector.protect(plainText)

    expect(protectedBytes.byteLength).toBeGreaterThan(0)
    expect(Buffer.from(protectedBytes).includes(Buffer.from(plainText, 'utf8'))).toBe(false)
    await expect(protector.unprotect(protectedBytes)).resolves.toBe(plainText)
  })
})

type SpawnLike = (executable: string, args: readonly string[], options: Record<string, unknown>) => FakeChildProcess

function createProcessRunner(spawnProcess: SpawnLike): (request: DpapiProcessRequest) => Promise<string> {
  return createDpapiProcessRunner(spawnProcess as never)
}

function processRequest(): DpapiProcessRequest {
  return {
    executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    args: ['-NoProfile'],
    stdin: 'synthetic-input',
    cwd: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
  }
}

class FakeInput extends EventEmitter {
  endedValue = ''

  end(value: string): void {
    this.endedValue = value
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stdin = new FakeInput()
  killCalls = 0

  constructor(private readonly options: { closeOnKill?: boolean } = {}) {
    super()
  }

  kill(): boolean {
    this.killCalls += 1
    if (this.options.closeOnKill) this.emit('close', null)
    return true
  }

  totalListenerCount(): number {
    return (
      this.listenerCount('error') +
      this.listenerCount('close') +
      this.stdout.listenerCount('data') +
      this.stdout.listenerCount('error') +
      this.stdin.listenerCount('error')
    )
  }
}
