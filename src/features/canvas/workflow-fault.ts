export type WorkflowFaultCode =
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_BALANCE_EXHAUSTED'
  | 'PROVIDER_PERMISSION_DENIED'
  | 'PROVIDER_REQUEST_REJECTED'
  | 'PROVIDER_SAFETY_REJECTED'
  | 'PLATFORM_PREFLIGHT_FAILED'
  | 'PLATFORM_QUEUE_FAILED'
  | 'PLATFORM_STORAGE_FAILED'
  | 'PLATFORM_RENDER_FAILED'
  | 'PLATFORM_INTERNAL_ERROR'
  | 'UPSTREAM_ARTIFACT_MISSING'
  | 'UPSTREAM_ARTIFACT_INVALID'
  | 'STAGE_INPUT_INVALID'
  | 'INTERNAL_PREFLIGHT_FAILED'
  | 'ROUTE_CONTRACT_INVALID'
  | 'MEDIA_NOT_READY'
  | 'TASK_INTERRUPTED'
  | 'RETRY_BUDGET_EXHAUSTED'
  | 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED'
  | 'QUOTA_EXHAUSTED'
  | 'CONFIGURATION_BLOCKED'
  | 'PROVIDER_FAILED'
  | 'FABRICATE_FAILED'
  | 'RENDER_FAILED'
  | 'MEDIA_FAILED'
  | 'QUEUE_FAILED'
  | 'STAGE_FAILED'

export type WorkflowErrorCode = WorkflowFaultCode
export type WorkflowFaultOrigin = 'user' | 'platform' | 'provider' | 'content' | 'unknown'
export type WorkflowRecovery =
  | 'auto_wait'
  | 'manual_retry'
  | 'fix_settings'
  | 'upgrade_plan'
  | 'edit_input'
  | 'switch_provider'
  | 'confirm_degraded_export'
  | 'contact_support'

export interface WorkflowFault {
  [key: string]: unknown
  schemaVersion: 2
  code: WorkflowFaultCode
  origin: WorkflowFaultOrigin
  stage: string
  title: string
  message: string
  retryable: boolean
  recovery: WorkflowRecovery
  sourceNodeId?: string
  provider?: {
    id: string
    label: string
    httpStatus?: number
    retryAt?: string
  }
  referenceId: string
  occurredAt: string
}

export type WorkflowErrorProjection = WorkflowFault

/** 业务流程成立但需要用户显式确认时的持久化门禁；它不是执行失败。 */
export interface WorkflowBlock {
  code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED'
  message: string
  recovery: 'confirm_degraded_export'
  referenceId: string
  blockedAt: string
  confirmationFingerprint: string
}

export interface WorkflowExecutionNotice {
  code: 'PROVIDER_RATE_LIMITED'
  message: string
  resumeAt: string
  providerLabel: string
}

interface ProviderErrorShape extends Error {
  providerId: string
  providerLabel: string
  funding: 'managed' | 'byok'
  httpStatus?: number
  retryAt?: string
  kind: string
  referenceId: string
  occurredAt: string
}

export function projectProviderFault(
  error: unknown,
  context: { stage: string; sourceNodeId?: string }
): WorkflowFault | undefined {
  if (!isProviderRequestError(error)) return undefined
  const classified = providerClassification(error)
  return {
    schemaVersion: 2,
    ...classified,
    stage: context.stage,
    ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
    provider: {
      id: error.providerId,
      label: error.providerLabel,
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
    },
    referenceId: error.referenceId,
    occurredAt: error.occurredAt,
  }
}

export function completeWorkflowFault(
  classified: Pick<WorkflowFault, 'code' | 'message' | 'retryable'>,
  context: { stage: string; sourceNodeId?: string }
): WorkflowFault {
  return {
    schemaVersion: 2,
    ...classified,
    ...presentationFor(classified.code),
    stage: context.stage,
    ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
    referenceId: globalThis.crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  }
}

function isProviderRequestError(error: unknown): error is ProviderErrorShape {
  if (!(error instanceof Error) || error.name !== 'ProviderRequestError') return false
  const value = error as Partial<ProviderErrorShape>
  return typeof value.providerId === 'string'
    && typeof value.providerLabel === 'string'
    && (value.funding === 'managed' || value.funding === 'byok')
    && typeof value.kind === 'string'
    && typeof value.referenceId === 'string'
    && typeof value.occurredAt === 'string'
}

function providerClassification(error: ProviderErrorShape) {
  const userFunded = error.funding === 'byok'
  switch (error.kind) {
    case 'rate_limit':
      return providerResult('PROVIDER_RATE_LIMITED', 'provider', '请求过于频繁，系统已自动排队',
        `${error.providerLabel}当前请求较多，系统会在可用时继续执行。`, true, 'auto_wait')
    case 'timeout':
      return providerResult('PROVIDER_TIMEOUT', 'provider', '第三方服务响应超时',
        `${error.providerLabel}未在时限内完成请求，系统会进行有界重试。`, true, 'manual_retry')
    case 'unavailable':
    case 'network':
      return providerResult('PROVIDER_UNAVAILABLE', 'provider', '第三方服务暂时不可用',
        `${error.providerLabel}当前无法稳定响应，可以稍后重新执行。`, true, 'manual_retry')
    case 'auth':
      return providerAccountResult(error, userFunded, 'PROVIDER_AUTH_FAILED', '认证未通过')
    case 'balance':
      return providerAccountResult(error, userFunded, 'PROVIDER_BALANCE_EXHAUSTED', '余额或套餐不可用')
    case 'permission':
      return providerAccountResult(error, userFunded, 'PROVIDER_PERMISSION_DENIED', '模型权限不足')
    case 'safety':
      return providerResult('PROVIDER_SAFETY_REJECTED', 'content', '内容未通过服务审核',
        '当前内容或素材被第三方服务拒绝，请修改后再试。', false, 'edit_input')
    case 'request':
      return providerResult('PROVIDER_REQUEST_REJECTED', 'content', '请求内容无法处理',
        '模型、输入或素材不符合当前服务要求，请修改设置或内容后再试。', false, 'edit_input')
    default:
      return providerResult('PLATFORM_INTERNAL_ERROR', 'unknown', '执行遇到未知问题',
        '系统尚不能确认具体原因，请使用参考号联系支持。', false, 'contact_support')
  }
}

function providerAccountResult(
  error: ProviderErrorShape,
  userFunded: boolean,
  code: WorkflowFaultCode,
  reason: string
) {
  if (userFunded) {
    return providerResult(code, 'user', `你的模型服务${reason}`,
      `当前使用的是你配置的 ${error.providerLabel} 账户，请检查 Key、余额或模型权限。`,
      false, code === 'PROVIDER_BALANCE_EXHAUSTED' ? 'upgrade_plan' : 'fix_settings')
  }
  return providerResult(code, 'platform', `平台托管服务${reason}`,
    `平台托管的 ${error.providerLabel} 服务配置需要处理，无需检查你自己的 Key。`,
    false, 'contact_support')
}

function providerResult(
  code: WorkflowFaultCode,
  origin: WorkflowFaultOrigin,
  title: string,
  message: string,
  retryable: boolean,
  recovery: WorkflowRecovery
) {
  return { code, origin, title, message, retryable, recovery }
}

function presentationFor(code: WorkflowFaultCode): {
  origin: WorkflowFaultOrigin
  title: string
  recovery: WorkflowRecovery
} {
  switch (code) {
    case 'QUOTA_EXHAUSTED':
      return { origin: 'user', title: '本周期 AI 额度已用完', recovery: 'upgrade_plan' }
    case 'CONFIGURATION_BLOCKED':
    case 'ROUTE_CONTRACT_INVALID':
      return { origin: 'user', title: '运行设置需要调整', recovery: 'fix_settings' }
    case 'UPSTREAM_ARTIFACT_MISSING':
    case 'UPSTREAM_ARTIFACT_INVALID':
      return { origin: 'platform', title: '生成结果未通过系统校验', recovery: 'manual_retry' }
    case 'STAGE_INPUT_INVALID':
      return { origin: 'content', title: '上游内容或素材需要修复', recovery: 'edit_input' }
    case 'TASK_INTERRUPTED':
    case 'MEDIA_NOT_READY':
      return { origin: 'platform', title: '任务暂时等待恢复', recovery: 'manual_retry' }
    case 'RETRY_BUDGET_EXHAUSTED':
      return { origin: 'platform', title: '自动重试已暂停', recovery: 'contact_support' }
    case 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED':
      return { origin: 'user', title: '需要确认降级导出', recovery: 'confirm_degraded_export' }
    case 'PROVIDER_FAILED':
      return { origin: 'provider', title: '第三方服务暂时不可用', recovery: 'manual_retry' }
    case 'INTERNAL_PREFLIGHT_FAILED':
    case 'QUEUE_FAILED':
    case 'FABRICATE_FAILED':
    case 'RENDER_FAILED':
    case 'MEDIA_FAILED':
    case 'PLATFORM_PREFLIGHT_FAILED':
    case 'PLATFORM_QUEUE_FAILED':
    case 'PLATFORM_STORAGE_FAILED':
    case 'PLATFORM_RENDER_FAILED':
    case 'PLATFORM_INTERNAL_ERROR':
      return { origin: 'platform', title: '平台执行遇到问题', recovery: 'manual_retry' }
    default:
      return { origin: 'unknown', title: '执行遇到未知问题', recovery: 'contact_support' }
  }
}
