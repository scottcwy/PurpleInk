import { createHash } from 'node:crypto'

export interface WebsiteBillingIdentity {
  invocationId: string
  inputHash: string
  idempotencyKey: string
}

export function createWebsiteBillingIdentity(input: {
  attemptId: string
  invocationNo: number
  requestIdentity: string | Uint8Array
  maximumSeconds: number
}): WebsiteBillingIdentity {
  const invocationId = stableInvocationUuid(input.attemptId, input.invocationNo)
  const inputHash = createHash('sha256')
    .update('website-video-request/v1:')
    .update(input.requestIdentity)
    .update(`:${input.maximumSeconds}`)
    .digest('hex')
  return {
    invocationId,
    inputHash,
    idempotencyKey: createHash('sha256')
      .update(`website-video-billing/v1:${invocationId}:${inputHash}`)
      .digest('hex'),
  }
}

export function requireWebsiteBillingContext(input: {
  attemptId: string
  invocationNo: number
}): void {
  if (
    input.attemptId.length === 0
    || !Number.isSafeInteger(input.invocationNo)
    || input.invocationNo < 1
  ) {
    throw new Error('网站视频调用缺少可审计的计费上下文')
  }
}

export function validateWebsiteOutputHash(outputHash: string | undefined): void {
  if (outputHash === undefined || /^[0-9a-f]{64}$/.test(outputHash)) return
  throw new Error('网站视频输出哈希必须是 SHA-256 十六进制')
}

function stableInvocationUuid(attemptId: string, invocationNo: number): string {
  const bytes = createHash('sha256')
    .update(`website-video-invocation/v1:${attemptId}:${invocationNo}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
