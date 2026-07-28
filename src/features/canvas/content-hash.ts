import { createHash } from 'node:crypto'

/**
 * 内容指纹纯函数（从 `status.ts` 拆出，无 DB/事务依赖）：
 * 键序归一后的 SHA-256 与 payload 指纹读取，供状态机与依赖比对复用。
 */

/** 对 JSON 可序列化输入生成跨进程稳定的 SHA-256。 */
export function computeContentHash(input: unknown): string {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new Error('内容哈希输入必须可 JSON 序列化')

  let normalized: unknown
  try {
    normalized = sortJsonValue(JSON.parse(serialized) as unknown)
  } catch (error) {
    throw new Error('内容哈希输入必须可 JSON 序列化', { cause: error })
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function readOutputContentHash(value: unknown): string | null {
  return (
    readPayloadHash(value, 'outputContentHash') ??
    readPayloadHash(value, 'contentHash')
  )
}

export function readInputFingerprint(value: unknown): string | null {
  return (
    readPayloadHash(value, 'inputFingerprint') ??
    readPayloadHash(value, 'contentHash')
  )
}

function readPayloadHash(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = (value as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const contentHash = (payload as Record<string, unknown>)[key]
  return typeof contentHash === 'string' ? contentHash : null
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)])
    )
  }
  return value
}
