export type AiProviderErrorCode =
  'AI_CONFIG_INVALID' | 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_OUTPUT_INVALID'

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AiProviderError'
  }
}
