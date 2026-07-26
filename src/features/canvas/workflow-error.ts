import { z } from 'zod'

export type WorkflowErrorCode =
  | 'UPSTREAM_ARTIFACT_MISSING'
  | 'UPSTREAM_ARTIFACT_INVALID'
  | 'STAGE_INPUT_INVALID'
  | 'CONFIGURATION_BLOCKED'
  | 'PROVIDER_FAILED'
  | 'FABRICATE_FAILED'
  | 'RENDER_FAILED'
  | 'MEDIA_FAILED'
  | 'QUEUE_FAILED'
  | 'STAGE_FAILED'

export interface WorkflowErrorProjection {
  code: WorkflowErrorCode
  stage: string
  message: string
  retryable: boolean
  sourceNodeId?: string
}

/** 分类结果：只含类别本身，stage 与来源节点由调用上下文补齐。 */
type ClassifiedError = Pick<
  WorkflowErrorProjection,
  'code' | 'message' | 'retryable'
>

/**
 * 把任意阶段异常投影成可展示、可判定是否值得重试的业务错误。
 *
 * 判定顺序是三段，且**类型优先于文案**：
 * 1. `classifyByType`：能靠类型确定的结构性错误（zod 合同、语义门禁）。
 *    必须最先判定——zod 报文里天然含 `required` / `invalid` 之类词，落进文案
 *    规则会被误判成「凭据不可用」这种不相关且不可重试的类别。
 * 2. `classifyByMessage`：只能从文案识别的外部原因（凭据、额度、缺失产物…）。
 * 3. `classifyByStage`：兜底按阶段职责给类别，不再让所有未识别错误都自称
 *    「镜头渲染失败」。
 *
 * 三段都不回显 provider 原始响应、prompt、凭据或隐藏推理。
 */
export function classifyWorkflowError(
  error: unknown,
  context: { stage: string; sourceNodeId?: string }
): WorkflowErrorProjection {
  const raw = error instanceof Error ? error.message : String(error)
  const classified =
    classifyByType(error, context.stage) ??
    classifyByMessage(raw) ??
    classifyByStage(context.stage)
  return {
    ...classified,
    stage: context.stage,
    ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
  }
}

function classifyByType(
  error: unknown,
  stage: string
): ClassifiedError | undefined {
  if (error instanceof z.ZodError) {
    return {
      code: 'STAGE_INPUT_INVALID',
      message: `${stage} 阶段输入未通过内部数据合同校验（字段：${describeIssuePaths(error)}）。重试不会改变结果，需要先修复上游产物或该阶段的输入合同。`,
      retryable: false,
    }
  }
  // 语义门禁错误来自 director 领域；此处只按类型名判定，避免 canvas 反向依赖
  // director 造成跨域循环。
  if (error instanceof Error && error.name === 'ArtifactValidationError') {
    return {
      code: 'UPSTREAM_ARTIFACT_INVALID',
      message: '上游产物未通过当前阶段的可信合同校验。',
      retryable: true,
    }
  }
  return undefined
}

/** 有序文案规则：先具体后笼统，命中即返回。 */
const MESSAGE_RULES: ReadonlyArray<readonly [RegExp, ClassifiedError]> = [
  [
    /StepFun\s+TTS.*HTTP\s*402/i,
    {
      code: 'CONFIGURATION_BLOCKED',
      message:
        'StepFun 配音服务返回 HTTP 402。请核对当前 Key 所属平台，以及该平台的 TTS 余额和权限。',
      retryable: false,
    },
  ],
  [
    /StepFun\s+TTS.*HTTP\s*400/i,
    {
      code: 'CONFIGURATION_BLOCKED',
      message: 'StepFun 配音请求被拒绝。请检查端点、模型、音色与账户套餐是否匹配。',
      retryable: false,
    },
  ],
  [
    /API\s*Key|credential|凭据|未配置|配置.+不可用|quota(?:_exceeded)?|billing|payment|required|HTTP\s*402|\b402\b|额度|配额|余额不足/i,
    {
      code: 'CONFIGURATION_BLOCKED',
      message: '运行配置或服务凭据不可用，请先检查项目设置。',
      retryable: false,
    },
  ],
  [
    /找不到|缺少|不存在|missing|not found/i,
    {
      code: 'UPSTREAM_ARTIFACT_MISSING',
      message: '上游产物缺失或不包含当前镜头，需要先修复上游阶段。',
      retryable: true,
    },
  ],
  [
    /产物校验|无效|不匹配|invalid/i,
    {
      code: 'UPSTREAM_ARTIFACT_INVALID',
      message: '上游产物未通过当前阶段的可信合同校验。',
      retryable: true,
    },
  ],
  [
    /queue|队列|入队/i,
    {
      code: 'QUEUE_FAILED',
      message: '作业暂时无法进入执行队列，请稍后重试。',
      retryable: true,
    },
  ],
  [
    /provider|模型|网络|timeout|超时|ASR|TTS/i,
    {
      code: 'PROVIDER_FAILED',
      message: '外部生成服务本次执行失败，可以稍后重试。',
      retryable: true,
    },
  ],
]

function classifyByMessage(message: string): ClassifiedError | undefined {
  return MESSAGE_RULES.find(([pattern]) => pattern.test(message))?.[1]
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
