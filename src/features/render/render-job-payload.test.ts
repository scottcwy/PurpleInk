import { describe, expect, it } from 'vitest'
import { renderJobPayloadSchema } from './render-job-payload'

describe('renderJobPayloadSchema', () => {
  it('normalizes a bounded revision brief for source regeneration', () => {
    expect(renderJobPayloadSchema.parse({
      projectId: 'project-1',
      nodeId: 'node-1',
      regenerateSource: true,
      revisionBrief: '  标题更克制  ',
    })).toEqual({
      projectId: 'project-1',
      nodeId: 'node-1',
      regenerateSource: true,
      revisionBrief: '标题更克制',
    })
  })

  it('does not allow a revision brief on an ordinary rerender job', () => {
    expect(() => renderJobPayloadSchema.parse({
      projectId: 'project-1',
      nodeId: 'node-1',
      forceRender: true,
      revisionBrief: '标题更克制',
    })).toThrow('revisionBrief 仅允许用于重新生成镜头代码')
  })

  it('keeps the complete HTML out of the persisted queue payload', () => {
    expect(() => renderJobPayloadSchema.parse({
      projectId: 'project-1',
      nodeId: 'node-1',
      regenerateSource: true,
      revisionBrief: '标题更克制',
      sourceHtml: '<html>完整旧稿</html>',
    })).toThrow()
  })
})
