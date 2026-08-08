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
  if (isRecord(error) && typeof error.code === 'string' && knownCommandCode(error.code)) {
    return {
      code: error.code,
      message: safeCommandMessage(error.code),
      retryable: error.code === 'MEDIA_QA_FAILED',
    }
  }
  return { code: 'CLI_FAILED', message: 'CLI 命令执行失败。', retryable: false }
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
