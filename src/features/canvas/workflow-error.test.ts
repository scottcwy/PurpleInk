import { describe, expect, it } from 'vitest'
import { classifyWorkflowError } from './workflow-error'

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
})
