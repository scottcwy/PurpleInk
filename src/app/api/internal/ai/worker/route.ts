import { NextResponse } from 'next/server'
import {
  WorkerGatewayError,
  executeWorkerAiRequest,
} from '@/features/ai/worker-gateway'
import { verifyWorkerGatewayKey } from '@/features/ai/worker-gateway-auth'
import {
  workerAiRequestSchema,
  type WorkerAiError,
} from '@/features/ai/worker-gateway-contract'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const auth = verifyWorkerGatewayKey(request.headers.get('authorization'))
  if (auth !== 'authorized') {
    return errorResponse('UNAUTHORIZED', auth === 'unconfigured' ? 503 : 401)
  }
  const body = await request.json().catch(() => null)
  const parsed = workerAiRequestSchema.safeParse(body)
  if (!parsed.success) return errorResponse('INVALID_REQUEST', 400)
  try {
    return NextResponse.json(await executeWorkerAiRequest(parsed.data))
  } catch (error) {
    if (error instanceof WorkerGatewayError) {
      const status = error.code === 'ATTEMPT_NOT_ACTIVE'
        ? 409
        : error.code === 'OPERATION_REPLAYED' ? 409 : 503
      return errorResponse(error.code, status)
    }
    console.error('[worker-ai-gateway] request failed', {
      category: error instanceof Error ? error.name : 'unknown',
      workload: parsed.data.workload,
      attemptId: parsed.data.attemptId,
    })
    return errorResponse('AI_UNAVAILABLE', 503)
  }
}

function errorResponse(code: WorkerAiError['code'], status: number): Response {
  return NextResponse.json({ ok: false, code } satisfies WorkerAiError, { status })
}
