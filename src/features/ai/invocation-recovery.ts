import 'server-only'
import { getDb, type Db } from '@/lib/db/client'
import {
  finalizeStoppedAiInvocationsInDatabase,
  reconcileOrphanedAiInvocationsInDatabase,
} from './invocation-recovery-core'

export async function reconcileOrphanedAiInvocations(
  database?: Db,
): Promise<string[]> {
  return reconcileOrphanedAiInvocationsInDatabase(database ?? await getDb())
}

export async function finalizeStoppedAiInvocations(
  attemptIds: string[],
  database?: Db,
): Promise<string[]> {
  return finalizeStoppedAiInvocationsInDatabase(database ?? await getDb(), attemptIds)
}
