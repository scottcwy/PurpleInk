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
})
