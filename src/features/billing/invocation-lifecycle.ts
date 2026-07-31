import { and, eq, isNull } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { aiInvocations } from '@/lib/db/schema'
import { ProviderInvocationAlreadyStartedError } from './contracts'

export async function markManagedInvocationStarted(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  const database = await getDb()
  const workspaceId = input.workspaceId ?? currentWorkspaceId()
  const now = new Date()
  const claimed = await database.update(aiInvocations).set({
    providerStartedAt: now,
    updatedAt: now,
  }).where(and(
    eq(aiInvocations.workspaceId, workspaceId),
    eq(aiInvocations.id, input.invocationId),
    eq(aiInvocations.status, 'running'),
    eq(aiInvocations.billingStatus, 'reserved'),
    isNull(aiInvocations.providerStartedAt),
  )).returning({ id: aiInvocations.id })
  if (claimed.length === 0) throw new ProviderInvocationAlreadyStartedError()
}
