export type WorkflowErrorCode =
  | 'UPSTREAM_ARTIFACT_MISSING'
  | 'UPSTREAM_ARTIFACT_INVALID'
  | 'CONFIGURATION_BLOCKED'
  | 'PROVIDER_FAILED'
  | 'FABRICATE_FAILED'
  | 'RENDER_FAILED'
  | 'QUEUE_FAILED'

export interface WorkflowErrorProjection {
  code: WorkflowErrorCode
  stage: string
  message: string
  retryable: boolean
  sourceNodeId?: string
}

export function classifyWorkflowError(
  error: unknown,
  context: { stage: string; sourceNodeId?: string }
): WorkflowErrorProjection {
  const raw = error instanceof Error ? error.message : String(error)
  const classified = classify(raw, error, context.stage)
  return {
    ...classified,
    stage: context.stage,
    ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
  }
}

function classify(
  message: string,
  error: unknown,
  stage: string
): Pick<WorkflowErrorProjection, 'code' | 'message' | 'retryable'> {
  if (/API\s*Key|credential|凭据|未配置|配置.+不可用/i.test(message)) {
    return {
      code: 'CONFIGURATION_BLOCKED',
      message: '运行配置或服务凭据不可用，请先检查项目设置。',
      retryable: false,
    }
  }
  if (/找不到|缺少|不存在|missing|not found/i.test(message)) {
    return {
      code: 'UPSTREAM_ARTIFACT_MISSING',
      message: '上游产物缺失或不包含当前镜头，需要先修复上游阶段。',
      retryable: true,
    }
  }
  if (
    (error instanceof Error && error.name === 'ArtifactValidationError') ||
    /产物校验|无效|不匹配|invalid/i.test(message)
  ) {
    return {
      code: 'UPSTREAM_ARTIFACT_INVALID',
      message: '上游产物未通过当前阶段的可信合同校验。',
      retryable: true,
    }
  }
  if (/queue|队列|入队/i.test(message)) {
    return {
      code: 'QUEUE_FAILED',
      message: '作业暂时无法进入执行队列，请稍后重试。',
      retryable: true,
    }
  }
  if (/provider|模型|网络|timeout|超时|ASR|TTS/i.test(message)) {
    return {
      code: 'PROVIDER_FAILED',
      message: '外部生成服务本次执行失败，可以稍后重试。',
      retryable: true,
    }
  }
  if (stage === 'FABRICATE') {
    return {
      code: 'FABRICATE_FAILED',
      message: '镜头代码生成失败，可以修复该镜头后继续。',
      retryable: true,
    }
  }
  return {
    code: 'RENDER_FAILED',
    message: '镜头渲染或媒体处理失败，可以稍后重试。',
    retryable: true,
  }
}
