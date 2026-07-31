import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

export type WorkerGatewayAuthResult =
  | 'authorized'
  | 'unauthorized'
  | 'unconfigured'

export function verifyWorkerGatewayKey(
  authorization: string | null,
  configuredKey = process.env.PURPLEINK_ENGINE_INTERNAL_KEY,
): WorkerGatewayAuthResult {
  if (!configuredKey) return 'unconfigured'
  const received = /^Bearer[ \t]+(.+)$/i.exec(authorization ?? '')?.[1]
  if (!received) return 'unauthorized'
  const left = createHash('sha256').update(received).digest()
  const right = createHash('sha256').update(configuredKey).digest()
  return timingSafeEqual(left, right) ? 'authorized' : 'unauthorized'
}
