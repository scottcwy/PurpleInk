import { describe, expect, it } from 'vitest'
import {
  createCredentialEnvelope,
  decodeCredentialEnvelopeWire,
  encodeCredentialEnvelopeWire,
  openCredentialEnvelope,
  parseCredentialMasterKey,
} from './credential-envelope'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const MASTER_KEY_BASE64 = Buffer.alloc(32, 17).toString('base64')

describe('credential envelope', () => {
  it('imports without server state and round-trips a binary AES-256-GCM envelope', () => {
    const masterKey = parseCredentialMasterKey(MASTER_KEY_BASE64)
    const envelope = createCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      secret: 'sk-中文-secret',
      masterKey,
    })

    expect(envelope).toMatchObject({
      envelopeVersion: 1,
      keyVersion: 'v1',
    })
    expect(envelope.nonce).toHaveLength(12)
    expect(envelope.authTag).toHaveLength(16)
    expect(Buffer.from(envelope.ciphertext).toString('utf8')).not.toContain(
      'sk-中文-secret',
    )
    expect(openCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      envelope,
      masterKey,
    })).toBe('sk-中文-secret')
  })

  it('requires an explicit canonical 32-byte base64 master key', () => {
    expect(() => parseCredentialMasterKey(undefined)).toThrow(
      'CVC_CREDENTIAL_MASTER_KEY is required',
    )
    expect(() => parseCredentialMasterKey('')).toThrow(
      'CVC_CREDENTIAL_MASTER_KEY is required',
    )
    expect(() => parseCredentialMasterKey(Buffer.alloc(31).toString('base64')))
      .toThrow('canonical 32-byte base64')
    expect(() => parseCredentialMasterKey(` ${MASTER_KEY_BASE64}`))
      .toThrow('canonical 32-byte base64')
    expect(() => parseCredentialMasterKey(MASTER_KEY_BASE64.replace(/=$/, '')))
      .toThrow('canonical 32-byte base64')
  })

  it('binds authentication to workspace, provider, envelope version, and key version', () => {
    const masterKey = parseCredentialMasterKey(MASTER_KEY_BASE64)
    const envelope = createCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'gemini',
      secret: 'bound-secret',
      masterKey,
    })

    for (const input of [
      { workspaceId: crypto.randomUUID(), provider: 'gemini', envelope },
      { workspaceId: WORKSPACE_ID, provider: 'stepfun', envelope },
      {
        workspaceId: WORKSPACE_ID,
        provider: 'gemini',
        envelope: { ...envelope, envelopeVersion: 2 },
      },
      {
        workspaceId: WORKSPACE_ID,
        provider: 'gemini',
        envelope: { ...envelope, keyVersion: 'v2' },
      },
    ]) {
      expect(() => openCredentialEnvelope({
        ...input,
        masterKey,
      })).toThrow('Provider credential authentication failed')
    }
  })

  it('strictly round-trips the versioned JSON/base64 wire representation', () => {
    const masterKey = parseCredentialMasterKey(MASTER_KEY_BASE64)
    const envelope = createCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      secret: 'exportable-secret',
      masterKey,
    })
    const wire = encodeCredentialEnvelopeWire(envelope)
    const parsed = JSON.parse(wire) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'envelopeVersion',
      'keyVersion',
      'ciphertext',
      'nonce',
      'authTag',
    ])
    expect(parsed.schemaVersion).toBe('cvc.provider-credential-envelope/v1')
    expect(openCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      envelope: decodeCredentialEnvelopeWire(wire),
      masterKey,
    })).toBe('exportable-secret')
  })

  it('rejects noncanonical, unknown, or tampered wire data without returning plaintext', () => {
    const masterKey = parseCredentialMasterKey(MASTER_KEY_BASE64)
    const envelope = createCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      secret: 'must-not-leak',
      masterKey,
    })
    const parsed = JSON.parse(
      encodeCredentialEnvelopeWire(envelope),
    ) as Record<string, unknown>
    const invalidWires = [
      '{',
      JSON.stringify({ ...parsed, extra: true }),
      JSON.stringify({ ...parsed, schemaVersion: 'cvc.unknown/v1' }),
      JSON.stringify({ ...parsed, nonce: `${String(parsed.nonce)}=` }),
      JSON.stringify({
        ...parsed,
        authTag: String(parsed.authTag).replace(/==$/, ''),
      }),
    ]

    for (const wire of invalidWires) {
      expect(() => decodeCredentialEnvelopeWire(wire))
        .toThrow('Invalid credential envelope wire format')
    }

    const tampered = decodeCredentialEnvelopeWire(
      encodeCredentialEnvelopeWire(envelope),
    )
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1
    expect(() => openCredentialEnvelope({
      workspaceId: WORKSPACE_ID,
      provider: 'stepfun',
      envelope: tampered,
      masterKey,
    })).toThrow('Provider credential authentication failed')
  })
})
