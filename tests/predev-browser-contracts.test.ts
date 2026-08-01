import { describe, expect, it } from 'vitest'

import {
  createEvidenceManifest,
  requireIsolatedProjectName,
  selectVerifiedImages,
  verifyComposeIsolation,
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

  it('permits only loopback Caddy and Postgres published ports in the isolated config', () => {
    expect(() => verifyComposeIsolation({
      networks: ['purpleink_predev_a1b2c3d4_app', 'purpleink_predev_a1b2c3d4_data', 'purpleink_predev_a1b2c3d4_edge'],
      volumes: ['purpleink_predev_a1b2c3d4_predev_postgres'],
      ports: [
        { service: 'caddy', hostIp: '127.0.0.1', target: 443 },
        { service: 'postgres', hostIp: '127.0.0.1', target: 5432 },
      ],
    }, 'purpleink_predev_a1b2c3d4')).not.toThrow()
    expect(() => verifyComposeIsolation({
      networks: ['purpleink_predev_a1b2c3d4_app'], volumes: [],
      ports: [{ service: 'web', hostIp: '0.0.0.0', target: 3000 }],
    }, 'purpleink_predev_a1b2c3d4')).toThrow('publish')
  })

  it('uses no-build images only when every image attests the current source revision', () => {
    const head = 'a'.repeat(40)
    expect(selectVerifiedImages(head, {
      web: { revision: head, image: 'purpleink-web:verify-predev' },
      worker: { revision: head, image: 'purpleink-worker:verify-predev' },
      migrate: { revision: head, image: 'purpleink-migrate:verify-predev' },
    })).toEqual({ mode: 'no-build', images: {
      web: 'purpleink-web:verify-predev', worker: 'purpleink-worker:verify-predev', migrate: 'purpleink-migrate:verify-predev',
    } })
    expect(selectVerifiedImages(head, {
      web: { revision: null, image: 'purpleink-web:verify-predev' },
      worker: { revision: head, image: 'purpleink-worker:verify-predev' },
      migrate: { revision: head, image: 'purpleink-migrate:verify-predev' },
    })).toEqual({ mode: 'build', images: null })
  })
})
