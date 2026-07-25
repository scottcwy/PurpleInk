import { describe, expect, it } from 'vitest'
import { buildShotClips, fullTrackClip } from './export-view-model'

describe('export view model', () => {
  it('projects the real lane count instead of a six-shot demo constant', () => {
    expect(buildShotClips(['S003', 'S001', 'S002'])).toEqual([
      { start: 4, width: 92, label: 'S001' },
      { start: 104, width: 92, label: 'S002' },
      { start: 204, width: 92, label: 'S003' },
    ])
  })

  it('sizes full-length audio tracks from the actual shot count', () => {
    expect(fullTrackClip('配音', 3)).toEqual([
      { start: 4, width: 292, label: '配音' },
    ])
    expect(fullTrackClip('配音', 0)).toEqual([])
  })
})
