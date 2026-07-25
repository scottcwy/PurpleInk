import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const ENVELOPE_VERSION = 1
const KEY_VERSION = 'v1'
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16
const MASTER_KEY_BYTES = 32
const MASTER_KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/
const WIRE_SCHEMA_VERSION = 'cvc.provider-credential-envelope/v1'
const WIRE_KEYS = [
  'schemaVersion',
  'envelopeVersion',
  'keyVersion',
  'ciphertext',
  'nonce',
  'authTag',
] as const

export interface CredentialEnvelope {
  envelopeVersion: number
  ciphertext: Uint8Array
  nonce: Uint8Array
  authTag: Uint8Array
  keyVersion: string
}

interface CredentialContext {
  workspaceId: string
  provider: string
}

interface CredentialEnvelopeWireV1 {
  schemaVersion: typeof WIRE_SCHEMA_VERSION
  envelopeVersion: typeof ENVELOPE_VERSION
  keyVersion: typeof KEY_VERSION
  ciphertext: string
  nonce: string
  authTag: string
}

export function parseCredentialMasterKey(encoded: string | undefined): Buffer {
  if (!encoded) {
    throw new Error('CVC_CREDENTIAL_MASTER_KEY is required')
  }
  if (!MASTER_KEY_BASE64.test(encoded)) {
    throw new Error(
      'CVC_CREDENTIAL_MASTER_KEY must be canonical 32-byte base64',
    )
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (
    decoded.length !== MASTER_KEY_BYTES
    || decoded.toString('base64') !== encoded
  ) {
    throw new Error(
      'CVC_CREDENTIAL_MASTER_KEY must be canonical 32-byte base64',
    )
  }
  return decoded
}

export function createCredentialEnvelope(
  input: CredentialContext & {
    secret: string
    masterKey: Uint8Array
  },
): CredentialEnvelope {
  validateContext(input)
  if (!input.secret) throw new Error('secret is required')
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(
    'aes-256-gcm',
    requireMasterKey(input.masterKey),
    nonce,
  )
  cipher.setAAD(additionalData(input, ENVELOPE_VERSION, KEY_VERSION))
  const ciphertext = Buffer.concat([
    cipher.update(input.secret, 'utf8'),
    cipher.final(),
  ])
  return {
    envelopeVersion: ENVELOPE_VERSION,
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: KEY_VERSION,
  }
}

export function openCredentialEnvelope(
  input: CredentialContext & {
    envelope: CredentialEnvelope
    masterKey: Uint8Array
  },
): string {
  try {
    validateContext(input)
    validateEnvelope(input.envelope)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      requireMasterKey(input.masterKey),
      Buffer.from(input.envelope.nonce),
    )
    decipher.setAAD(additionalData(
      input,
      input.envelope.envelopeVersion,
      input.envelope.keyVersion,
    ))
    decipher.setAuthTag(Buffer.from(input.envelope.authTag))
    return Buffer.concat([
      decipher.update(Buffer.from(input.envelope.ciphertext)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error('Provider credential authentication failed')
  }
}

export function encodeCredentialEnvelopeWire(
  envelope: CredentialEnvelope,
): string {
  try {
    validateEnvelope(envelope)
    const wire: CredentialEnvelopeWireV1 = {
      schemaVersion: WIRE_SCHEMA_VERSION,
      envelopeVersion: ENVELOPE_VERSION,
      keyVersion: KEY_VERSION,
      ciphertext: Buffer.from(envelope.ciphertext).toString('base64'),
      nonce: Buffer.from(envelope.nonce).toString('base64'),
      authTag: Buffer.from(envelope.authTag).toString('base64'),
    }
    return JSON.stringify(wire)
  } catch {
    throw invalidWire()
  }
}

export function decodeCredentialEnvelopeWire(
  encoded: string,
): CredentialEnvelope {
  try {
    const value: unknown = JSON.parse(encoded)
    if (!isWireRecord(value)) throw invalidWire()
    return {
      envelopeVersion: value.envelopeVersion,
      keyVersion: value.keyVersion,
      ciphertext: decodeCanonicalBase64(value.ciphertext),
      nonce: decodeCanonicalBase64(value.nonce, NONCE_BYTES),
      authTag: decodeCanonicalBase64(value.authTag, AUTH_TAG_BYTES),
    }
  } catch {
    throw invalidWire()
  }
}

function additionalData(
  context: CredentialContext,
  envelopeVersion: number,
  keyVersion: string,
): Buffer {
  return Buffer.from(JSON.stringify({
    schema: 'cvc.provider-credential-envelope',
    envelopeVersion,
    keyVersion,
    workspaceId: context.workspaceId,
    provider: context.provider,
  }), 'utf8')
}

function validateContext(context: CredentialContext): void {
  if (!context.workspaceId) throw new Error('workspaceId is required')
  if (!context.provider) throw new Error('provider is required')
}

function requireMasterKey(masterKey: Uint8Array): Buffer {
  const key = Buffer.from(masterKey)
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error('Credential master key must be 32 bytes')
  }
  return key
}

function validateEnvelope(envelope: CredentialEnvelope): void {
  if (
    envelope.envelopeVersion !== ENVELOPE_VERSION
    || envelope.keyVersion !== KEY_VERSION
    || !(envelope.ciphertext instanceof Uint8Array)
    || envelope.ciphertext.length === 0
    || !(envelope.nonce instanceof Uint8Array)
    || envelope.nonce.length !== NONCE_BYTES
    || !(envelope.authTag instanceof Uint8Array)
    || envelope.authTag.length !== AUTH_TAG_BYTES
  ) {
    throw new Error('Unsupported credential envelope')
  }
}

function isWireRecord(value: unknown): value is CredentialEnvelopeWireV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [...WIRE_KEYS].sort()
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && record.schemaVersion === WIRE_SCHEMA_VERSION
    && record.envelopeVersion === ENVELOPE_VERSION
    && record.keyVersion === KEY_VERSION
    && typeof record.ciphertext === 'string'
    && typeof record.nonce === 'string'
    && typeof record.authTag === 'string'
}

function decodeCanonicalBase64(value: string, bytes?: number): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw invalidWire()
  }
  const decoded = Buffer.from(value, 'base64')
  if (
    decoded.toString('base64') !== value
    || (bytes !== undefined && decoded.length !== bytes)
  ) {
    throw invalidWire()
  }
  return decoded
}

function invalidWire(): Error {
  return new Error('Invalid credential envelope wire format')
}
