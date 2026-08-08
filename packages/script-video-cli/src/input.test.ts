import { describe, expect, it } from 'vitest'

import { hashSourceBytes, parseScriptText, parseScriptValue } from './input'

describe('script-video.v1 input', () => {
  it('normalizes markdown headings into ordered script units', () => {
    const result = parseScriptText('# Demo\n\n## Opening\n真实事实。\n\n## Proof\n第二个事实。', 'script.md')

    expect(result.title).toBe('Demo')
    expect(result.units).toEqual([
      { id: 'U001', text: '真实事实。', visualIntent: 'show' },
      { id: 'U002', text: '第二个事实。', visualIntent: 'show' },
    ])
  })

  it('accepts strict JSON and rejects duplicate or empty units', () => {
    const valid = {
      schemaVersion: 1,
      title: 'Demo',
      language: 'zh-CN',
      durationSec: 30,
      visualStyle: 'technical',
      narration: 'off',
      units: [{ id: 'U001', text: '事实。', visualIntent: 'show' }],
    } as const

    expect(parseScriptValue(valid).units).toHaveLength(1)
    expect(() =>
      parseScriptValue({
        ...valid,
        units: [
          { id: 'U001', text: '事实。', visualIntent: 'show' },
          { id: 'U001', text: '重复。', visualIntent: 'show' },
        ],
      }),
    ).toThrow(/重复/)
    expect(() => parseScriptValue({ ...valid, units: [{ id: 'U001', text: '', visualIntent: 'show' }] })).toThrow()
    expect(() => parseScriptValue({ ...valid, unexpected: true })).toThrow()
  })

  it('keeps duration inside the supported local-video range', () => {
    const base = {
      schemaVersion: 1,
      title: 'Demo',
      language: 'zh-CN',
      visualStyle: 'technical',
      narration: 'off',
      units: [{ id: 'U001', text: '事实。', visualIntent: 'show' }],
    } as const

    expect(parseScriptValue({ ...base, durationSec: 5 }).durationSec).toBe(5)
    expect(parseScriptValue({ ...base, durationSec: 600 }).durationSec).toBe(600)
    expect(() => parseScriptValue({ ...base, durationSec: 4 })).toThrow()
    expect(() => parseScriptValue({ ...base, durationSec: 601 })).toThrow()
  })

  it('hashes the original UTF-8 source bytes', () => {
    expect(hashSourceBytes(Buffer.from('PurpleInk', 'utf8'))).toBe(
      '4ea4f487416cca9a4219becf787c8a96f36bac172deb1c8b910699c9f8abe539',
    )
  })
})
