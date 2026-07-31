import type { WorkflowErrorProjection } from './workflow-fault'

export type ClassifiedError = Pick<
  WorkflowErrorProjection,
  'code' | 'message' | 'retryable'
>

export const PROVIDER_UNAVAILABLE_PROJECTION: ClassifiedError = {
  code: 'PROVIDER_FAILED',
  message: 'AI 服务暂时不可用，可稍后重试或选择跳过',
  retryable: true,
}

export const RETRY_BUDGET_EXHAUSTED_PROJECTION: ClassifiedError = {
  code: 'RETRY_BUDGET_EXHAUSTED',
  message:
    '该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过',
  retryable: false,
}

export const QUOTA_EXHAUSTED_PROJECTION: ClassifiedError = {
  code: 'QUOTA_EXHAUSTED',
  message: '本周期 AI 额度已用完，请升级套餐或等待下个周期重置。',
  retryable: false,
}

const MESSAGE_RULES: ReadonlyArray<readonly [RegExp, ClassifiedError]> = [
  [/quota_exhausted|Managed AI quota is exhausted/i, QUOTA_EXHAUSTED_PROJECTION],
  [
    /配音媒体尚未就绪|媒体尚未就绪/,
    {
      code: 'MEDIA_NOT_READY',
      message:
        '本项目的配音媒体尚未就绪。配音是异步生成的，请先完成或重试 INGEST 的配音，再执行依赖音频时序的阶段。',
      retryable: true,
    },
  ],
  [
    /执行进程中断|租约过期/,
    {
      code: 'TASK_INTERRUPTED',
      message: '执行进程中断，任务已自动回收。这是系统回收僵尸任务的保护机制，可放心重试',
      retryable: true,
    },
  ],
  [/已暂停重试/, RETRY_BUDGET_EXHAUSTED_PROJECTION],
  [/AI 服务暂时不可用/, PROVIDER_UNAVAILABLE_PROJECTION],
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
    /API\s*Key|credential|凭据|未配置|配置.+不可用|quota(?:_exceeded)?|billing|payment|required|HTTP\s*(?:400|401|402|403)\b|\b(?:400|401|402|403)\b|额度|配额|余额不足/i,
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

export function classifyByMessage(message: string): ClassifiedError | undefined {
  return MESSAGE_RULES.find(([pattern]) => pattern.test(message))?.[1]
}
