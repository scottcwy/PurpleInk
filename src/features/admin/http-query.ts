export function positiveQueryInteger(
  value: string | null,
  fallback: number,
  maximum: number,
): number {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}
