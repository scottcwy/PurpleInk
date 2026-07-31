import { and, eq, isNull } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { aiInvocations } from '@/lib/db/schema'

export async function markManagedInvocationStarted(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  const database = await getDb()
  const workspaceId = input.workspaceId ?? currentWorkspaceId()
  const now = new Date()
  await database.update(aiInvocations).set({
    providerStartedAt: now,
    updatedAt: now,
  }).where(and(
    eq(aiInvocations.workspaceId, workspaceId),
    eq(aiInvocations.id, input.invocationId),
    eq(aiInvocations.status, 'running'),
    eq(aiInvocations.billingStatus, 'reserved'),
    isNull(aiInvocations.providerStartedAt),
  ))
}
