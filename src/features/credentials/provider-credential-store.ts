import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '@/lib/db/client'
import { providerCredentials } from '@/lib/db/schema/index'
import {
  createCredentialEnvelope,
  openCredentialEnvelope,
  parseCredentialMasterKey,
} from './credential-envelope'

export type DatabaseProvider = () => Promise<PostgresDb>

export interface ProviderCredentialStore {
  save(input: {
    workspaceId: string
    provider: string
    secret: string
    verifiedAt: Date
  }): Promise<void>
  loadSecret(workspaceId: string, provider: string): Promise<string | null>
  describe(workspaceId: string, provider: string): Promise<{
    configured: boolean
    verifiedAt: string | null
    updatedAt: string | null
  }>
}

function masterKey(): Buffer {
  return parseCredentialMasterKey(process.env.CVC_CREDENTIAL_MASTER_KEY)
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

export class PostgresProviderCredentialStore implements ProviderCredentialStore {
  constructor(private readonly database: DatabaseProvider) {}

  async save(input: {
    workspaceId: string
    provider: string
    secret: string
    verifiedAt: Date
  }): Promise<void> {
    const workspaceId = nonEmpty(input.workspaceId, 'workspaceId')
    const provider = nonEmpty(input.provider, 'provider')
    const secret = nonEmpty(input.secret, 'secret')
    const envelope = createCredentialEnvelope({
      workspaceId,
      provider,
      secret,
      masterKey: masterKey(),
    })
    const db = await this.database()
    await db.insert(providerCredentials).values({
      workspaceId,
      provider,
      ...envelope,
      verifiedAt: input.verifiedAt,
    }).onConflictDoUpdate({
      target: [
        providerCredentials.workspaceId,
        providerCredentials.provider,
      ],
      set: {
        ...envelope,
        verifiedAt: input.verifiedAt,
        updatedAt: new Date(),
      },
    })
  }

  async loadSecret(
    workspaceIdInput: string,
    providerInput: string,
  ): Promise<string | null> {
    const workspaceId = nonEmpty(workspaceIdInput, 'workspaceId')
    const provider = nonEmpty(providerInput, 'provider')
    const db = await this.database()
    const [row] = await db.select({
      envelopeVersion: providerCredentials.envelopeVersion,
      ciphertext: providerCredentials.ciphertext,
      nonce: providerCredentials.nonce,
      authTag: providerCredentials.authTag,
      keyVersion: providerCredentials.keyVersion,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.workspaceId, workspaceId),
      eq(providerCredentials.provider, provider),
    )).limit(1)
    return row
      ? openCredentialEnvelope({
          workspaceId,
          provider,
          envelope: row,
          masterKey: masterKey(),
        })
      : null
  }

  async describe(
    workspaceIdInput: string,
    providerInput: string,
  ): Promise<{
    configured: boolean
    verifiedAt: string | null
    updatedAt: string | null
  }> {
    const workspaceId = nonEmpty(workspaceIdInput, 'workspaceId')
    const provider = nonEmpty(providerInput, 'provider')
    const db = await this.database()
    const [row] = await db.select({
      verifiedAt: providerCredentials.verifiedAt,
      updatedAt: providerCredentials.updatedAt,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.workspaceId, workspaceId),
      eq(providerCredentials.provider, provider),
    )).limit(1)
    return row
      ? {
          configured: true,
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { configured: false, verifiedAt: null, updatedAt: null }
  }
}
