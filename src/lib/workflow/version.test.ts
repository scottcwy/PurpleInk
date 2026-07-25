import { describe, expect, it } from 'vitest'
import { ACTIVE_WORKFLOW_VERSION, serializeWorkflowVersion } from './version'

describe('ACTIVE_WORKFLOW_VERSION', () => {
  it('固定当前 1920×1080 内容与渲染管线版本', () => {
    expect(ACTIVE_WORKFLOW_VERSION).toEqual({
      workflow: 'cvc-v3-foundation',
      contracts: 'cvc-arch-v3.0.0',
      compiler: 'fabricate-landscape-1920x1080-v1',
      hyperframes: 'landscape-render-1920x1080-v1',
      renderImage: 'node22-playwright1.61.1-ffmpeg-static5.3.0',
    })
  })

  it('使用固定字段顺序序列化，供 N2 fingerprint 消费', () => {
    expect(serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)).toBe(
      'cvc-v3-foundation|cvc-arch-v3.0.0|fabricate-landscape-1920x1080-v1|' +
        'landscape-render-1920x1080-v1|node22-playwright1.61.1-ffmpeg-static5.3.0'
    )
  })
})
