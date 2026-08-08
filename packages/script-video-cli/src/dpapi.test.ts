import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { WindowsCurrentUserDpapiProtector } from './dpapi'

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('WindowsCurrentUserDpapiProtector', () => {
  windowsIt('round-trips a synthetic secret through the real CurrentUser DPAPI', async () => {
    const protector = new WindowsCurrentUserDpapiProtector()
    const plainText = `purpleink-dpapi-roundtrip-${randomUUID()}`

    const protectedBytes = await protector.protect(plainText)

    expect(protectedBytes.byteLength).toBeGreaterThan(0)
    expect(Buffer.from(protectedBytes).includes(Buffer.from(plainText, 'utf8'))).toBe(false)
    await expect(protector.unprotect(protectedBytes)).resolves.toBe(plainText)
  })
})
