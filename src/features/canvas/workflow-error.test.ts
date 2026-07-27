import { describe, expect, it } from 'vitest'
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
  it('turns missing upstream artifacts into a safe retryable projection', () => {
    expect(
      classifyWorkflowError(
        new Error('shot plan 中找不到 S002；provider payload=secret'),
        { stage: 'FABRICATE', sourceNodeId: 'shot-script-s002' }
      )
    ).toEqual({
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
