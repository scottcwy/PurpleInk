import { describe, expect, it } from 'vitest'
import { ACTIVE_WORKFLOW_VERSION, serializeWorkflowVersion } from './version'

describe('ACTIVE_WORKFLOW_VERSION', () => {
  it('诚实描述 N0 仍在运行的 legacy compiler/seek 管线', () => {
    expect(ACTIVE_WORKFLOW_VERSION).toEqual({
      workflow: 'cvc-v3-foundation',
      contracts: 'cvc-arch-v3.0.0',
      compiler: 'legacy-html-v1',
      hyperframes: 'legacy-cvc-render-v1',
      renderImage: 'node22-playwright1.61.1-ffmpeg-static5.3.0',
    })
  })

  it('使用固定字段顺序序列化，供 N2 fingerprint 消费', () => {
    expect(serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)).toBe(
      'cvc-v3-foundation|cvc-arch-v3.0.0|legacy-html-v1|' +
        'legacy-cvc-render-v1|node22-playwright1.61.1-ffmpeg-static5.3.0'
    )
  })
})
