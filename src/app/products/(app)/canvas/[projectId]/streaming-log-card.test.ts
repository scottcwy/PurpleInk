import { describe, expect, it } from 'vitest'
import type { DirectorNodeError, RenderNodeError } from '@/features/canvas'
import { resolveVisibleStageError } from './streaming-log-card'

const HISTORICAL_ERROR: DirectorNodeError = {
  stage: 'INGEST',
  message: '上一次执行失败',
}

const RENDER_FAILURE: RenderNodeError = {
  message: 'ffmpeg 编码失败：退出码 1',
}

describe('resolveVisibleStageError', () => {
  it('does not present a historical failure after the node succeeds', () => {
    expect(
      resolveVisibleStageError('success', HISTORICAL_ERROR, undefined, undefined)
    ).toBeUndefined()
  })

  it('presents the persisted director failure while the node is currently failed', () => {
    expect(
      resolveVisibleStageError('failed', HISTORICAL_ERROR, undefined, undefined)
    ).toEqual(HISTORICAL_ERROR)
  })

  it('presents the persisted render failure with a distinct stage label', () => {
    expect(
      resolveVisibleStageError('failed', undefined, RENDER_FAILURE, undefined)
    ).toEqual({ stage: '渲染', message: RENDER_FAILURE.message })
  })

  it('prefers directorError over renderError when both are somehow present', () => {
    expect(
      resolveVisibleStageError('failed', HISTORICAL_ERROR, RENDER_FAILURE, undefined)
    ).toEqual(HISTORICAL_ERROR)
  })

  it('falls back to the live stream failure while the node is currently failed', () => {
    const streamError: DirectorNodeError = {
      stage: 'DIRECT',
      message: '流式请求失败',
    }
    expect(
      resolveVisibleStageError('failed', undefined, undefined, streamError)
    ).toEqual(streamError)
  })
})
