import { describe, expect, it } from 'vitest'
import type { DirectorNodeError } from '@/features/canvas'
import { resolveVisibleStageError } from './streaming-log-card'

const HISTORICAL_ERROR: DirectorNodeError = {
  stage: 'INGEST',
  message: '上一次执行失败',
}

describe('resolveVisibleStageError', () => {
  it('does not present a historical failure after the node succeeds', () => {
    expect(resolveVisibleStageError('success', HISTORICAL_ERROR, undefined)).toBeUndefined()
  })

  it('presents the persisted failure while the node is currently failed', () => {
    expect(resolveVisibleStageError('failed', HISTORICAL_ERROR, undefined)).toEqual(
      HISTORICAL_ERROR
    )
  })

  it('falls back to the live stream failure while the node is currently failed', () => {
    const streamError: DirectorNodeError = {
      stage: 'DIRECT',
      message: '流式请求失败',
    }
    expect(resolveVisibleStageError('failed', undefined, streamError)).toEqual(streamError)
  })
})
