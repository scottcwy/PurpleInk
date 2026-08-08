export interface MapWithConcurrencyOptions {
  signal?: AbortSignal
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: MapWithConcurrencyOptions = {},
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) {
    throw new RangeError('并发数必须是 1 到 32 的整数')
  }
  options.signal?.throwIfAborted()
  if (items.length === 0) return []

  const results = new Array<R>(items.length)
  let nextIndex = 0
  let stopped = false

  async function consume(): Promise<void> {
    while (true) {
      options.signal?.throwIfAborted()
      if (stopped) return
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index]!, index)
      } catch (error) {
        stopped = true
        throw error
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => consume(),
  )
  await Promise.all(workers)
  options.signal?.throwIfAborted()
  return results
}
