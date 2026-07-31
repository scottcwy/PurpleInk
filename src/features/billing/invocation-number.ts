export type BillingInvocationScope =
  | 'director'
  | 'narration'
  | 'subtitle-asr'
  | 'vision-qa'
  | 'source-asr'
  | 'worker-text'
  | 'worker-tts'

const PARTITION = {
  director: { start: 1, size: 9_999 },
  narration: { start: 10_000, size: 10_000 },
  'subtitle-asr': { start: 20_000, size: 10_000 },
  'vision-qa': { start: 30_000, size: 10_000 },
  'source-asr': { start: 40_000, size: 10_000 },
  'worker-text': { start: 50_000, size: 10_000 },
  'worker-tts': { start: 60_000, size: 10_000 },
} as const satisfies Record<
  BillingInvocationScope,
  { start: number; size: number }
>

export function billingInvocationNo(
  scope: BillingInvocationScope,
  index: number,
): number {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new Error(`计费调用序号无效：${scope} 必须从 1 开始`)
  }
  const partition = PARTITION[scope]
  if (index > partition.size) {
    throw new Error(`计费调用序号超出 ${scope} 分区`)
  }
  return partition.start + index - 1
}
