import { describe, expect, it } from 'vitest'
import { buildLaneSpans, buildResolutionOptions } from './export-view-model'

describe('export view model', () => {
  it('lays lanes out in sorted order across the full track width', () => {
    expect(buildLaneSpans(['S003', 'S001', 'S002'])).toEqual([
      { start: 0, width: 1 / 3, label: 'S001' },
      { start: 1 / 3, width: 1 / 3, label: 'S002' },
      { start: 2 / 3, width: 1 / 3, label: 'S003' },
    ])
  })

  it('leaves a gap for a missing lane instead of shifting later lanes forward', () => {
    // 回归锁：S002 缺产物时 S003 必须留在第三格。旧实现按过滤后的数组重新编号，
    // 把 S003 画到第二格，暗示错误的时间位置且与分镜轨对不齐。
    expect(buildLaneSpans(['S001', 'S002', 'S003'], ['S001', 'S003'])).toEqual([
      { start: 0, width: 1 / 3, label: 'S001' },
      { start: 2 / 3, width: 1 / 3, label: 'S003' },
    ])
  })

  it('spans the whole width for a single lane and stays empty without lanes', () => {
    expect(buildLaneSpans(['S001'])).toEqual([
      { start: 0, width: 1, label: 'S001' },
    ])
    expect(buildLaneSpans([])).toEqual([])
    expect(buildLaneSpans([], ['S001'])).toEqual([])
  })

  it('ignores lanes that are present but not part of the project', () => {
    expect(buildLaneSpans(['S001'], ['S001', 'S404'])).toEqual([
      { start: 0, width: 1, label: 'S001' },
    ])
  })

  it('projects every supported resolution preset to its existing tier label', () => {
    expect(buildResolutionOptions()).toEqual([
      { value: '1920x1080', label: '高清' },
      { value: '1280x720', label: '标清' },
      { value: '960x540', label: '流畅' },
    ])
  })
})
