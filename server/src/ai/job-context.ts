import { AsyncLocalStorage } from "node:async_hooks"
import type {
  WorkerAiRequest,
} from "../../../src/features/ai/worker-gateway-contract"

type WorkerAiWorkload = WorkerAiRequest["workload"]

export interface WorkerAiJobIdentity {
  workspaceId: string
  attemptId: string
  requestId: string
}

interface WorkerAiJobContext extends WorkerAiJobIdentity {
  operationIndex: number
}

const storage = new AsyncLocalStorage<WorkerAiJobContext>()

export function runWithWorkerAiContext<T>(
  identity: WorkerAiJobIdentity,
  operation: () => T,
): T {
  return storage.run({ ...identity, operationIndex: 0 }, operation)
}

export function nextWorkerAiOperation(workload: WorkerAiWorkload): {
  workspaceId: string
  attemptId: string
  operationId: string
  operationIndex: number
} {
  const context = storage.getStore()
  if (!context) {
    throw new Error("WORKER_AI_CONTEXT_MISSING")
  }
  context.operationIndex += 1
  return {
    workspaceId: context.workspaceId,
    attemptId: context.attemptId,
    operationId: `${context.requestId}:${workload}:${context.operationIndex}`,
    operationIndex: context.operationIndex,
  }
}
