export interface MapWithConcurrencyOptions {
  signal?: AbortSignal
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
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
  let firstError: unknown
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forwardAbort, { once: true })

  async function consume(): Promise<void> {
    while (true) {
      options.signal?.throwIfAborted()
      if (stopped) return
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index]!, index, controller.signal)
      } catch (error) {
        stopped = true
        if (firstError === undefined) firstError = error
        controller.abort(error)
        return
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => consume())
  try {
    await Promise.all(workers)
    options.signal?.throwIfAborted()
    if (firstError !== undefined) throw firstError
    return results
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}
