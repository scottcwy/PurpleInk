interface RuntimeProbeDeadlineOptions {
  signal?: AbortSignal
  operationTimeoutMs: number
  totalTimeoutMs: number
}

export interface RuntimeProbeDeadline {
  signal?: AbortSignal
  expiresAt: number
  nextTimeout(scope?: 'operation' | 'total'): number
}

export class RuntimeProbeTimeoutError extends Error {
  constructor(step: string) {
    super(`FABRICATE runtime probe ${step} timeout`)
    this.name = 'RuntimeProbeTimeoutError'
  }
}

export function createRuntimeProbeDeadline(
  options: RuntimeProbeDeadlineOptions,
): RuntimeProbeDeadline {
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    expiresAt: Date.now() + options.totalTimeoutMs,
    nextTimeout(scope = 'operation') {
      return Math.max(
        1,
        Math.min(
          scope === 'operation'
            ? options.operationTimeoutMs
            : options.totalTimeoutMs,
          this.expiresAt - Date.now(),
        ),
      )
    },
  }
}

export async function runWithinProbeDeadline<T>(
  operation: Promise<T>,
  deadline: RuntimeProbeDeadline,
  step: string,
  onExpire: () => void,
  scope: 'operation' | 'total' = 'operation',
): Promise<T> {
  deadline.signal?.throwIfAborted()
  if (deadline.expiresAt <= Date.now()) {
    onExpire()
    throw new RuntimeProbeTimeoutError(step)
  }
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      deadline.signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      cleanup()
      onExpire()
      reject(error)
    }
    const onAbort = () => fail(deadline.signal?.reason)
    const timer = setTimeout(
      () => fail(new RuntimeProbeTimeoutError(step)),
      deadline.nextTimeout(scope),
    )
    deadline.signal?.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}
