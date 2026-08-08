import { AiProviderError, type AiProviderErrorCode } from './ai/openai-compatible'

export interface SafeErrorProjection {
  code: string
  message: string
  retryable: boolean
  stageKey?: string
  shotId?: string
}

export class SafeCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number,
    readonly context: { stageKey?: string; shotId?: string } = {},
  ) {
    super(message)
    this.name = 'SafeCliError'
  }
}

export function projectSafeError(error: unknown): SafeErrorProjection {
  if (error instanceof SafeCliError) {
    return compactProjection({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      stageKey: error.context.stageKey,
      shotId: error.context.shotId,
    })
  }
  if (error instanceof AiProviderError) {
    const safe = aiProviderSafeErrors[error.code]
    return { code: error.code, message: safe.message, retryable: safe.retryable }
  }
  if (isRecord(error) && typeof error.code === 'string' && knownCommandCode(error.code)) {
    return {
      code: error.code,
      message: safeCommandMessage(error.code),
      retryable: error.code === 'MEDIA_QA_FAILED',
    }
  }
  return { code: 'CLI_FAILED', message: 'CLI 命令执行失败。', retryable: false }
}

const aiProviderSafeErrors: Record<AiProviderErrorCode, { message: string; retryable: boolean }> = {
  AI_CONFIG_INVALID: { message: 'AI provider 配置无效。', retryable: false },
  AI_TIMEOUT: { message: 'AI provider 请求超时。', retryable: true },
  AI_RATE_LIMITED: { message: 'AI provider 请求受限。', retryable: true },
  AI_PROVIDER_UNAVAILABLE: { message: 'AI provider 暂时不可用。', retryable: true },
  AI_OUTPUT_INVALID: { message: 'AI provider 返回内容无效。', retryable: false },
}

function compactProjection(value: SafeErrorProjection): SafeErrorProjection {
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(value.stageKey ? { stageKey: value.stageKey } : {}),
    ...(value.shotId ? { shotId: value.shotId } : {}),
  }
}

function knownCommandCode(code: string): boolean {
  return code === 'INPUT_REQUIRED' || code === 'RUN_NOT_FOUND' || code === 'MEDIA_QA_FAILED'
}

function safeCommandMessage(code: string): string {
  if (code === 'INPUT_REQUIRED') return '命令缺少文稿输入。'
  if (code === 'RUN_NOT_FOUND') return '没有找到本地 run。'
  return '视频媒体 QA 未通过。'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
