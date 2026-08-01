import { describe, expect, it } from 'vitest'

import {
  createEvidenceManifest,
  requireIsolatedProjectName,
  verifyAdminGuardMatrix,
  verifyMediaRange,
} from '../scripts/verify/predev-browser/contracts'

describe('predev browser acceptance contracts', () => {
  it('writes a secret-free evidence manifest with stable runtime facts', () => {
    const manifest = createEvidenceManifest({
      commit: 'a'.repeat(40),
      baseUrl: 'http://127.0.0.1:49152',
      composeProject: 'purpleink_predev_a1b2c3d4',
      secretValues: ['replace-me', 'also-secret'],
      facts: { cookie: 'cvc_session=replace-me', password: 'also-secret', ok: true },
    })

    expect(manifest.commit).toBe('a'.repeat(40))
    expect(JSON.stringify(manifest)).not.toContain('replace-me')
    expect(JSON.stringify(manifest)).not.toContain('also-secret')
    expect(manifest.facts).toEqual({ cookie: 'cvc_session=[REDACTED]', password: '[REDACTED]', ok: true })
  })

  it('accepts only a uniquely owned temporary Compose project name', () => {
    expect(requireIsolatedProjectName('purpleink_predev_a1b2c3d4')).toBe('purpleink_predev_a1b2c3d4')
    expect(() => requireIsolatedProjectName('purpleink')).toThrow('temporary Compose project')
    expect(() => requireIsolatedProjectName('purpleink-dev')).toThrow('temporary Compose project')
  })

  it('requires unauthenticated, ordinary-user, and admin outcomes for every admin target', () => {
    expect(() => verifyAdminGuardMatrix([
      { target: '/admin', unauthenticated: 307, user: 404, admin: 200 },
      { target: '/api/admin/jobs', unauthenticated: 401, user: 404, admin: 200 },
    ])).not.toThrow()
    expect(() => verifyAdminGuardMatrix([
      { target: '/admin', unauthenticated: 200, user: 404, admin: 200 },
    ])).toThrow('unauthenticated')
  })

  it('requires byte-identical media downloads and a valid 206 byte range', () => {
    expect(() => verifyMediaRange({
      fullHash: 'f'.repeat(64), localHash: 'f'.repeat(64), status: 206,
      contentRange: 'bytes 0-31/100', bytes: 32,
    })).not.toThrow()
    expect(() => verifyMediaRange({
      fullHash: 'a'.repeat(64), localHash: 'a'.repeat(64), status: 200,
      contentRange: null, bytes: 0,
    })).toThrow('range')
  })
})
