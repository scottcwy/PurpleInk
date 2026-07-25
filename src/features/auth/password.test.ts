import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('produces a different encoded string for the same password (salt is live)', async () => {
    const first = await hashPassword('correct horse battery 7')
    const second = await hashPassword('correct horse battery 7')

    expect(first).not.toEqual(second)
  })

  it('encodes algorithm and parameters so they can be raised later', async () => {
    const encoded = await hashPassword('correct horse battery 7')

    expect(encoded.split('$')[0]).toBe('scrypt')
    expect(encoded.split('$')).toHaveLength(6)
  })

  it('never embeds the plaintext password', async () => {
    const encoded = await hashPassword('correct horse battery 7')

    expect(encoded).not.toContain('correct')
  })

  it('accepts the correct password', async () => {
    const encoded = await hashPassword('correct horse battery 7')

    await expect(verifyPassword('correct horse battery 7', encoded)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword('correct horse battery 7')

    await expect(verifyPassword('correct horse battery 8', encoded)).resolves.toBe(false)
  })

  it('rejects a tampered digest instead of throwing', async () => {
    const encoded = await hashPassword('correct horse battery 7')
    const parts = encoded.split('$')
    parts[5] = 'AAAA'
    const tampered = parts.join('$')

    await expect(verifyPassword('correct horse battery 7', tampered)).resolves.toBe(false)
  })

  it('rejects structurally invalid encodings instead of throwing', async () => {
    for (const broken of ['', 'scrypt', 'scrypt$a$b$c$d$e', 'argon2$1$1$1$c2FsdA$aGFzaA']) {
      await expect(verifyPassword('correct horse battery 7', broken)).resolves.toBe(false)
    }
  })
})
