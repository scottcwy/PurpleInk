import { describe, expect, it } from 'vitest'
import type { CanvasGraphNode } from '@/features/canvas'
import { isNodeActionBlocked, nodeActionLabel } from './node-action-presentation'

function node(overrides: Partial<CanvasGraphNode>): CanvasGraphNode {
  return {
    id: 'node-1',
    type: 'script-import',
    stage: 'INGEST',
    status: 'idle',
    contentHash: null,
    data: {},
    laneKey: null,
    laneRole: null,
    artifacts: [],
    ...overrides,
  }
}

describe('node action presentation', () => {
  it('blocks non-retryable failures and points users to project settings', () => {
    const blocked = node({
      status: 'failed',
      directorError: {
        code: 'CONFIGURATION_BLOCKED',
        stage: 'INGEST',
        message: '请检查配置',
        retryable: false,
      },
    })

    expect(isNodeActionBlocked(blocked)).toBe(true)
    expect(nodeActionLabel(blocked)).toBe('请先检查项目设置')
  })

  it('keeps retryable failures available for repair', () => {
    const retryable = node({
      status: 'failed',
      directorError: {
        code: 'PROVIDER_FAILED',
        stage: 'INGEST',
        message: '稍后重试',
        retryable: true,
      },
    })

    expect(isNodeActionBlocked(retryable)).toBe(false)
    expect(nodeActionLabel(retryable)).toBe('修复并继续')
  })
})
