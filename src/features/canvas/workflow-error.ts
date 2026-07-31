import { z } from 'zod'
import {
  completeWorkflowFault,
  projectProviderFault,
  type WorkflowErrorProjection,
} from './workflow-fault'
import {
  classifyByMessage,
  PROVIDER_UNAVAILABLE_PROJECTION,
  QUOTA_EXHAUSTED_PROJECTION,
  RETRY_BUDGET_EXHAUSTED_PROJECTION,
  type ClassifiedError,
} from './workflow-error-message'
export type {
  WorkflowErrorCode,
  WorkflowErrorProjection,
  WorkflowFault,
  WorkflowFaultCode,
  WorkflowFaultOrigin,
  WorkflowRecovery,
  WorkflowExecutionNotice,
  WorkflowBlock,
} from './workflow-fault'
/** 把任意阶段异常投影成可展示、可判定是否值得重试的业务错误。
 * 判定顺序是三段，且**类型优先于文案**：
 * 1. `classifyByType`：能靠类型确定的结构性错误（zod 合同、语义门禁）。
 *    必须最先判定——zod 报文里天然含 `required` / `invalid` 之类词，落进文案
 *    规则会被误判成「凭据不可用」这种不相关且不可重试的类别。
 * 2. `classifyByMessage`：只能从文案识别的外部原因（凭据、额度、缺失产物…）。
 * 3. `classifyByStage`：兜底按阶段职责给类别，不再让所有未识别错误都自称
 *    「镜头渲染失败」。
 * 三段都不回显 provider 原始响应、prompt、凭据或隐藏推理。
 */
export function classifyWorkflowError(
  error: unknown,
  context: { stage: string; sourceNodeId?: string }
): WorkflowErrorProjection {
  const existing = embeddedWorkflowFault(error)
  if (existing) return existing
  const raw = error instanceof Error ? error.message : String(error)
  const providerFault = projectProviderFault(error, context)
  if (providerFault) return rememberWorkflowFault(error, providerFault)
  const classified =
    classifyByType(error, context.stage) ??
    classifyByMessage(raw) ??
    classifyByStage(context.stage)
  return rememberWorkflowFault(
    error,
    completeWorkflowFault(classified, context)
  )
}

const WORKFLOW_FAULT = Symbol('workflowFault')

function embeddedWorkflowFault(error: unknown): WorkflowErrorProjection | undefined {
  if (isWorkflowFault(error)) return error
  if (!(error instanceof Error)) return undefined
  return (error as Error & {
    [WORKFLOW_FAULT]?: WorkflowErrorProjection
  })[WORKFLOW_FAULT]
}

function rememberWorkflowFault(
  error: unknown,
  fault: WorkflowErrorProjection
): WorkflowErrorProjection {
  if (error instanceof Error) {
    Object.defineProperty(error, WORKFLOW_FAULT, {
      value: fault,
      configurable: false,
      enumerable: false,
      writable: false,
    })
  }
  return fault
}

function isWorkflowFault(value: unknown): value is WorkflowErrorProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 2
    && typeof record.code === 'string'
    && typeof record.stage === 'string'
    && typeof record.referenceId === 'string'
    && typeof record.occurredAt === 'string'
    && typeof record.retryable === 'boolean'
}

function classifyByType(
  error: unknown,
  stage: string
): ClassifiedError | undefined {
  if (error instanceof Error && error.name === 'QuotaExhaustedError') {
    return QUOTA_EXHAUSTED_PROJECTION
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'STAGE_INPUT_INVALID',
      message: `${stage} 阶段输入未通过内部数据合同校验（字段：${describeIssuePaths(error)}）。重试不会改变结果，需要先修复上游产物或该阶段的输入合同。`,
      retryable: false,
    }
  }
  if (error instanceof Error && error.name === 'DirectorPreflightError') {
    return {
      code: 'INTERNAL_PREFLIGHT_FAILED',
      message: `${stage} 阶段在调用模型前未通过内部执行前置检查。重试不会改变结果，需要先修复任务审计或计费上下文。`,
      retryable: false,
    }
  }
  if (error instanceof Error && error.name === 'AudioSourceIntegrityError') return {
    code: 'AUDIO_SOURCE_INTEGRITY_INVALID',
    message: '上传的录音文件未通过来源完整性校验，请重新上传原始音频创建项目。',
    retryable: false,
  }
  // 语义门禁错误来自 director 领域；此处只按类型名判定，避免 canvas 反向依赖
  // director 造成跨域循环。
  if (error instanceof Error && error.name === 'ArtifactValidationError') {
    return {
      code: 'UPSTREAM_ARTIFACT_INVALID',
      message: '模型生成的产物未通过系统可信合同，坏版本已被拒绝，系统可重新生成。',
      retryable: true,
    }
  }
  if (error instanceof Error && error.name === 'DirectorToolOutputError') {
    return {
      code: 'UPSTREAM_ARTIFACT_INVALID',
      message: '模型未提交完整的结构化产物，当前不完整结果已被拒绝，系统可重新生成。',
      retryable: true,
    }
  }
  if (error instanceof Error && error.name === 'ExportExecutionError') {
    return {
      code: 'PLATFORM_RENDER_FAILED',
      message: '终片导出在平台执行阶段失败，系统已保留安全参考号以便诊断。',
      retryable: true,
    }
  }
  if (error instanceof Error && error.name === 'FinalArtifactNotReadyError') {
    return {
      code: 'FINAL_ARTIFACT_NOT_READY',
      message: '终片尚未生成，系统不会提前执行最终审阅。请先完成正常或降级合成。',
      retryable: false,
    }
  }
  // 路由 / 能力矛盾来自 features/ai；同样只按类型名判定，避免反向依赖。报文里
  // 常含「模型 / TTS / ASR」，若落进文案规则会被误判成可重试的 PROVIDER_FAILED
  // （真实事故：shot-sfx 的路由矛盾曾被这样误判）。
  if (error instanceof Error && error.name === 'RouteContractError') {
    return {
      code: 'ROUTE_CONTRACT_INVALID',
      message: `${stage} 阶段的模型路由配置存在矛盾：${error.message}。重试不会改变结果，需要先在项目设置里修正供应商或模型选择。`,
      retryable: false,
    }
  }
  // 重试预算闸门来自 lib/queue/retry-policy；同样只按类型名判定，避免 canvas
  // 反向依赖队列层。预算耗尽是硬停：继续重试只会继续烧预算，必须不可重试。
  if (error instanceof Error && error.name === 'RetryBudgetExhaustedError') {
    return RETRY_BUDGET_EXHAUSTED_PROJECTION
  }
  if (isManagedAiError(error)) {
    if (error.code === 'MANAGED_MODEL_NOT_AUTHORIZED') {
      return {
        code: 'ROUTE_NOT_AUTHORIZED',
        message: '当前套餐或工作区无权使用所选模型，请调整模型设置后重新执行。',
        retryable: false,
      }
    }
    if (error.code === 'MANAGED_CREDENTIAL_UNAVAILABLE') {
      return {
        code: 'CONFIGURATION_BLOCKED',
        message: '平台模型服务配置暂不可用，请使用参考号联系支持。',
        retryable: false,
      }
    }
    return {
      code: 'PROVIDER_FAILED',
      message: '外部生成服务本次执行失败，可以稍后重试。',
      retryable: error.retryable,
    }
  }
  if (
    error instanceof Error &&
    error.name === 'DegradedExportConfirmationRequiredError'
  ) {
    return {
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      message: '项目包含已跳过或未验收分镜，请前往导出页显式确认降级导出。',
      retryable: false,
    }
  }
  // 熔断降级链的「主备均不可用」来自 features/ai；同样只按类型名判定。
  // 这是外部服务故障，熔断窗口过后重试有意义，必须可重试（模式 B）。
  if (error instanceof Error && error.name === 'ProviderUnavailableError') {
    return PROVIDER_UNAVAILABLE_PROJECTION
  }
  return undefined
}

function isManagedAiError(error: unknown): error is Error & {
  code: 'MANAGED_MODEL_NOT_AUTHORIZED'
    | 'MANAGED_CREDENTIAL_UNAVAILABLE'
    | 'MANAGED_UPSTREAM_FAILED'
  retryable: boolean
} {
  if (!(error instanceof Error) || error.name !== 'ManagedAiError') return false
  const value = error as Error & { code?: unknown; retryable?: unknown }
  return [
    'MANAGED_MODEL_NOT_AUTHORIZED',
    'MANAGED_CREDENTIAL_UNAVAILABLE',
    'MANAGED_UPSTREAM_FAILED',
  ].includes(String(value.code)) && typeof value.retryable === 'boolean'
}

/**
 * 阶段兜底。`RENDER_FAILED` 只属于真实渲染阶段：文本阶段失败被贴上渲染失败
 * 曾让 SHOT_SPEC 的合同错误显示成「镜头渲染或媒体处理失败」，完全指错方向。
 */
const STAGE_FALLBACKS: Readonly<Record<string, ClassifiedError>> = {
  QUEUE: {
    code: 'QUEUE_FAILED',
    message: '作业暂时无法进入执行队列，请稍后重试。',
    retryable: true,
  },
  FABRICATE: {
    code: 'FABRICATE_FAILED',
    message: '镜头代码生成失败，可以修复该镜头后继续。',
    retryable: true,
  },
  RENDER: {
    code: 'RENDER_FAILED',
    message: '镜头渲染或媒体处理失败，可以稍后重试。',
    retryable: true,
  },
  MEDIA_NARRATION: {
    code: 'MEDIA_FAILED',
    message: '配音媒体生成本次失败，可以稍后重试。',
    retryable: true,
  },
}

function classifyByStage(stage: string): ClassifiedError {
  return (
    STAGE_FALLBACKS[stage] ?? {
      code: 'STAGE_FAILED',
      message: `${stage} 阶段本次执行失败，可以稍后重试。`,
      retryable: true,
    }
  )
}

/**
 * 汇总 zod 违规字段路径。只暴露我们自己合同的字段名（不含取值），既能定位问题
 * 又不泄漏原稿、凭据或 provider 响应。多余键会被展开成具体键名——真实事故里
 * 「哪个键多了」正是唯一有用的信息。
 */
function describeIssuePaths(error: z.ZodError): string {
  const paths = new Set(error.issues.flatMap(issuePaths))
  const listed = [...paths].slice(0, 3)
  return paths.size > listed.length ? `${listed.join('、')} 等` : listed.join('、')
}

function issuePaths(issue: z.core.$ZodIssue): string[] {
  const base = issue.path.map(String).join('.')
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => (base ? `${base}.${key}` : key))
  }
  return [base || '(根)']
}
