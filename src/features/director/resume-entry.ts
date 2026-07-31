import type { QueueEnqueueReceipt } from '@/lib/queue'
import type {
  AdvanceCandidate,
  EnqueueDirectorStage,
  PipelineRepository,
} from './advance'

interface EntryResumeResult {
  attempt: QueueEnqueueReceipt | null
  enqueued: boolean
}

export async function resumePipelineEntry(
  projectId: string,
  entry: AdvanceCandidate,
  repository: PipelineRepository,
  enqueueDirectorStage: EnqueueDirectorStage,
): Promise<EntryResumeResult> {
  if (isRestartable(entry)) {
    assertIngestEntry(entry)
    return {
      attempt: receiptFromEnqueue(await enqueueDirectorStage({
        projectId,
        nodeId: entry.id,
        stage: 'INGEST',
      })),
      enqueued: true,
    }
  }

  if (entry.status !== 'pending' || !repository.findActiveAttempt) {
    return { attempt: null, enqueued: false }
  }

  const activeAttempt = await repository.findActiveAttempt(projectId, entry.id)
  if (activeAttempt) return { attempt: activeAttempt, enqueued: true }

  assertIngestEntry(entry)
  return {
    attempt: receiptFromEnqueue(await enqueueDirectorStage(
      {
        projectId,
        nodeId: entry.id,
        stage: 'INGEST',
      },
      { preservePending: true },
    )),
    enqueued: true,
  }
}

function isRestartable(entry: AdvanceCandidate): boolean {
  return ['idle', 'stale', 'cancelled'].includes(entry.status)
    || (entry.status === 'failed' && entry.retryable === true)
}

function assertIngestEntry(entry: AdvanceCandidate): void {
  if (entry.stage !== 'INGEST') {
    throw new Error(`项目入口节点阶段无效：${entry.stage ?? 'null'}`)
  }
}

function receiptFromEnqueue(
  result: string | QueueEnqueueReceipt,
): QueueEnqueueReceipt | null {
  return typeof result === 'string' ? null : result
}
