import { describe, expect, it } from 'vitest'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
import { z } from 'zod'
import { classifyWorkflowError } from './workflow-error'

/**
 * 复刻真实 SHOT_SPEC 事故：`target.sourceUnit` 是 strict 对象，上游多带了
 * 一个 `order` 键，zod 在任何模型调用之前抛错。
 */
function stageInputError(): unknown {
  const schema = z.object({
    target: z.object({
      sourceUnit: z.object({ unitId: z.string(), text: z.string() }).strict(),
    }),
  })
  try {
    schema.parse({
      target: { sourceUnit: { unitId: 'U001', text: '原稿正文', order: 0 } },
    })
    throw new Error('该输入本应校验失败')
  } catch (error) {
    return error
  }
}

describe('classifyWorkflowError', () => {
  it.each([
    [401, 'auth', 'PROVIDER_AUTH_FAILED'],
    [402, 'balance', 'PROVIDER_BALANCE_EXHAUSTED'],
    [403, 'permission', 'PROVIDER_PERMISSION_DENIED'],
  ] as const)('assigns BYOK HTTP %s to the user', (httpStatus, kind, code) => {
    const fault = classifyWorkflowError(new ProviderRequestError({
      providerId: 'openai-compatible',
      providerLabel: '自定义模型',
      operation: '文本生成',
      funding: 'byok',
      httpStatus,
      kind,
    }), { stage: 'INGEST' })
    expect(fault).toMatchObject({
      schemaVersion: 2,
      code,
      origin: 'user',
      recovery: code === 'PROVIDER_BALANCE_EXHAUSTED' ? 'upgrade_plan' : 'fix_settings',
      provider: { httpStatus },
    })
  })

  it('assigns a managed credential failure to the platform', () => {
    const fault = classifyWorkflowError(new ProviderRequestError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '文本生成',
      funding: 'managed',
      httpStatus: 401,
    }), { stage: 'SHOT_SPEC' })
    expect(fault).toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      origin: 'platform',
      recovery: 'contact_support',
    })
    expect(fault.message).toContain('无需检查你自己的 Key')
  })

  it('projects 429 as provider-owned automatic waiting', () => {
    const fault = classifyWorkflowError(new ProviderRequestError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '文本生成',
      funding: 'managed',
      httpStatus: 429,
      retryAt: new Date('2026-07-29T00:01:00.000Z'),
    }), { stage: 'FABRICATE' })
    expect(fault).toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      origin: 'provider',
      retryable: true,
      recovery: 'auto_wait',
      provider: {
        label: '阶跃星辰',
        httpStatus: 429,
        retryAt: '2026-07-29T00:01:00.000Z',
      },
    })
  })
  it('projects quota exhaustion as a non-retryable workflow stop', () => {
    const error = Object.assign(new Error('Managed AI quota is exhausted'), {
      name: 'QuotaExhaustedError',
    })

    expect(classifyWorkflowError(error, { stage: 'DIRECT' })).toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      retryable: false,
    })
  })
  it('turns missing upstream artifacts into a safe retryable projection', () => {
    expect(
      classifyWorkflowError(
        new Error('shot plan 中找不到 S002；provider payload=secret'),
        { stage: 'FABRICATE', sourceNodeId: 'shot-script-s002' }
      )
    ).toMatchObject({
      code: 'UPSTREAM_ARTIFACT_MISSING',
      stage: 'FABRICATE',
      message: '上游产物缺失或不包含当前镜头，需要先修复上游阶段。',
      retryable: true,
      sourceNodeId: 'shot-script-s002',
    })
  })

  it('blocks configuration failures without exposing credential details', () => {
    expect(
      classifyWorkflowError(new Error('尚未配置 StepFun API Key: sk-secret'), {
        stage: 'INGEST',
      })
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      message: '运行配置或服务凭据不可用，请先检查项目设置。',
      retryable: false,
    })
  })

  it('assigns an invalid model-generated artifact to platform recovery', () => {
    const error = Object.assign(new Error('raw validation detail'), {
      name: 'ArtifactValidationError',
    })
    expect(classifyWorkflowError(error, { stage: 'FABRICATE' })).toMatchObject({
      code: 'UPSTREAM_ARTIFACT_INVALID',
      origin: 'platform',
      title: '生成结果未通过系统校验',
      message: '模型生成的产物未通过系统可信合同，坏版本已被拒绝，系统可重新生成。',
      recovery: 'manual_retry',
      retryable: true,
    })
  })

  it('classifies a missing Director tool submission without message regex guessing', () => {
    const error = Object.assign(new Error('tool output was truncated'), {
      name: 'DirectorToolOutputError',
    })
    expect(classifyWorkflowError(error, { stage: 'FABRICATE' })).toMatchObject({
      code: 'UPSTREAM_ARTIFACT_INVALID',
      origin: 'platform',
      recovery: 'manual_retry',
    })
  })

  it('does not retry when a managed credential is absent', () => {
    expect(
      classifyWorkflowError(
        new Error('托管 AI 服务凭据未配置，请联系管理员完成服务配置。'),
        { stage: 'MEDIA_NARRATION' },
      ),
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      retryable: false,
    })
  })

  it('treats exhausted provider quota as a non-retryable configuration block', () => {
    expect(
      classifyWorkflowError(
        new Error('provider request failed: 402 quota_exceeded; billing account unavailable'),
        { stage: 'INGEST' }
      )
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      message: '运行配置或服务凭据不可用，请先检查项目设置。',
      retryable: false,
    })
  })

  it('stops retrying a sanitized Director authorization status', () => {
    expect(
      classifyWorkflowError(
        new Error('Director 模型调用失败（StepFun/step-chat，HTTP 402）'),
        { stage: 'INGEST' },
      ),
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      retryable: false,
    })
  })

  it('names a StepFun TTS 402 without exposing provider response details', () => {
    expect(
      classifyWorkflowError(new Error('StepFun TTS 请求失败（HTTP 402）'), {
        stage: 'INGEST',
      })
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      message: 'StepFun 配音服务返回 HTTP 402。请核对当前 Key 所属平台，以及该平台的 TTS 余额和权限。',
      retryable: false,
    })
  })

  it('reports an invalid StepFun TTS contract as a configuration block', () => {
    expect(
      classifyWorkflowError(new Error('StepFun TTS 请求失败（HTTP 400）'), {
        stage: 'INGEST',
      })
    ).toMatchObject({
      code: 'CONFIGURATION_BLOCKED',
      message: 'StepFun 配音请求被拒绝。请检查端点、模型、音色与账户套餐是否匹配。',
      retryable: false,
    })
  })

  it('names the failing contract field for a schema failure and stops pointless retries', () => {
    const projection = classifyWorkflowError(stageInputError(), {
      stage: 'SHOT_SPEC',
    })
    expect(projection.code).toBe('STAGE_INPUT_INVALID')
    expect(projection.stage).toBe('SHOT_SPEC')
    expect(projection.retryable).toBe(false)
    expect(projection.message).toContain('SHOT_SPEC')
    expect(projection.message).toContain('target.sourceUnit.order')
    expect(projection.message).not.toContain('原稿正文')
  })

  it('tells the operator that async narration is not ready yet', () => {
    expect(
      classifyWorkflowError(
        new Error(
          '配音媒体尚未就绪：director-ingest 产物不含可用的 audioManifest / audioAllocation。'
        ),
        { stage: 'FABRICATE' }
      )
    ).toMatchObject({
      code: 'MEDIA_NOT_READY',
      retryable: true,
    })
  })

  it('marks a lease-expired interruption as retryable TASK_INTERRUPTED', () => {
    // 租约过期回收（sweepExpiredLeases）写入的原始报文：进程中断不是业务失败，
    // 重试必须可行，且不得被误判成外部 provider 或产物问题。
    expect(
      classifyWorkflowError(new Error('执行进程中断，租约过期自动回收'), {
        stage: 'INGEST',
      })
    ).toMatchObject({
      code: 'TASK_INTERRUPTED',
      stage: 'INGEST',
      message: '执行进程中断，任务已自动回收。这是系统回收僵尸任务的保护机制，可放心重试',
      retryable: true,
    })
  })

  it('marks a route/capability contract mismatch as a non-retryable configuration issue', () => {
    class RouteContractError extends Error {
      override readonly name = 'RouteContractError'
    }
    const projection = classifyWorkflowError(
      new RouteContractError('Google Gemini 不支持 TTS 路由'),
      { stage: 'ASSEMBLE', sourceNodeId: 'shot-sfx-s001' }
    )
    expect(projection.code).toBe('ROUTE_CONTRACT_INVALID')
    expect(projection.retryable).toBe(false)
    expect(projection.message).toContain('ASSEMBLE')
    expect(projection.message).toContain('不支持 TTS 路由')
  })

  it('classifies the retry budget gate by type name as a non-retryable stop', () => {
    // 复刻 lib/queue/retry-policy 抛出的闸门错误：canvas 只按类型名判定，
    // 避免反向依赖队列层（与 ArtifactValidationError / RouteContractError 同款先例）。
    class RetryBudgetExhaustedError extends Error {
      override readonly name = 'RetryBudgetExhaustedError'
    }
    const projection = classifyWorkflowError(
      new RetryBudgetExhaustedError(
        '该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过'
      ),
      { stage: 'INGEST' }
    )
    expect(projection.code).toBe('RETRY_BUDGET_EXHAUSTED')
    expect(projection.retryable).toBe(false)
    // 文案必须含暂停原因与出口指引，且不撞「配置/额度」等既有规则的笼统文案。
    expect(projection.message).toContain('已暂停重试')
    expect(projection.message).toContain('跳过')
  })

  it('classifies automatic degraded export as an explicit user confirmation gate', () => {
    class DegradedExportConfirmationRequiredError extends Error {
      override readonly name = 'DegradedExportConfirmationRequiredError'
    }
    const projection = classifyWorkflowError(
      new DegradedExportConfirmationRequiredError(),
      { stage: 'FINALIZE', sourceNodeId: 'export' }
    )

    expect(projection).toMatchObject({
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      origin: 'user',
      recovery: 'confirm_degraded_export',
      retryable: false,
    })
    expect(projection.message).toContain('显式确认降级导出')
  })

  it('classifies the persisted budget message without hitting broader rules', () => {
    // 闸门文案持久化到 attempt.failure 后会被再次分类（只剩字符串）：
    // 「已暂停重试」是独有词，不得被「修复配置」误判成 CONFIGURATION_BLOCKED。
    expect(
      classifyWorkflowError(
        new Error(
          '该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过'
        ),
        { stage: 'RENDER' }
      )
    ).toMatchObject({
      code: 'RETRY_BUDGET_EXHAUSTED',
      retryable: false,
    })
  })

  it('classifies an open-breaker outage by type name as retryable PROVIDER_FAILED', () => {
    // 阶段 4（模式 H）：主备 provider 均不可用是外部故障，必须可重试，
    // 且文案只给类别与出口指引，不回显任何 provider 原始错误。
    class ProviderUnavailableError extends Error {
      override readonly name = 'ProviderUnavailableError'
    }
    const projection = classifyWorkflowError(
      new ProviderUnavailableError('AI 服务暂时不可用，可稍后重试或选择跳过'),
      { stage: 'INGEST' }
    )
    expect(projection.code).toBe('PROVIDER_FAILED')
    expect(projection.retryable).toBe(true)
    expect(projection.message).toBe('AI 服务暂时不可用，可稍后重试或选择跳过')
  })

  it('classifies a Director preflight invariant as internal and non-retryable', () => {
    class DirectorPreflightError extends Error {
      override readonly name = 'DirectorPreflightError'
    }
    const projection = classifyWorkflowError(
      new DirectorPreflightError('托管 Director 调用缺少可审计的 attemptId'),
      { stage: 'FABRICATE' }
    )

    expect(projection).toMatchObject({
      code: 'INTERNAL_PREFLIGHT_FAILED',
      stage: 'FABRICATE',
      retryable: false,
    })
    expect(projection.message).toContain('调用模型前')
    expect(projection.message).not.toContain('attemptId')
  })

  it('classifies the persisted outage message without hitting broader rules', () => {
    // 文案持久化到 attempt.failure 后只剩字符串：「AI 服务暂时不可用」含「不可用」，
    // 不得被「配置/凭据不可用」误判成不可重试的 CONFIGURATION_BLOCKED。
    expect(
      classifyWorkflowError(
        new Error('AI 服务暂时不可用，可稍后重试或选择跳过'),
        { stage: 'FABRICATE' }
      )
    ).toMatchObject({
      code: 'PROVIDER_FAILED',
      retryable: true,
    })
  })

  it('never labels a non-render stage failure as a render failure', () => {
    for (const stage of ['INGEST', 'DIRECT', 'SHOT_SPEC', 'ASSEMBLE', 'FINALIZE']) {
      const projection = classifyWorkflowError(new Error('未知内部失败'), { stage })
      expect(projection.code).toBe('STAGE_FAILED')
      expect(projection.message).toContain(stage)
      expect(projection.message).not.toContain('渲染')
    }
  })

  it('keeps render, fabricate, queue and narration fallbacks on their own stages', () => {
    expect(classifyWorkflowError(new Error('未知内部失败'), { stage: 'RENDER' })).toMatchObject({
      code: 'RENDER_FAILED',
      message: '镜头渲染或媒体处理失败，可以稍后重试。',
      retryable: true,
    })
    expect(
      classifyWorkflowError(new Error('未知内部失败'), { stage: 'FABRICATE' })
    ).toMatchObject({ code: 'FABRICATE_FAILED', retryable: true })
    expect(
      classifyWorkflowError(new Error('未知内部失败'), { stage: 'QUEUE' })
    ).toMatchObject({ code: 'QUEUE_FAILED', retryable: true })
    expect(
      classifyWorkflowError(new Error('未知内部失败'), { stage: 'MEDIA_NARRATION' })
    ).toMatchObject({ code: 'MEDIA_FAILED', retryable: true })
  })
})
