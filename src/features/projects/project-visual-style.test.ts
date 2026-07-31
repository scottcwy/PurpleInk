import { describe, expect, it } from 'vitest'
import {
  normalizeProjectVisualStyle,
  readProjectVisualStyleFormData,
} from './project-visual-style'

describe('project visual style', () => {
  it('keeps default behavior free of extra source fields', () => {
    expect(normalizeProjectVisualStyle({ visualStyle: 'default' })).toEqual({})
    expect(normalizeProjectVisualStyle({})).toEqual({})
  })

  it('normalizes controlled and custom visual style requirements', () => {
    expect(normalizeProjectVisualStyle({ visualStyle: 'flat' })).toEqual({
      visualStyle: 'flat',
    })
    expect(
      normalizeProjectVisualStyle({
        visualStyle: 'custom',
        customVisualStyle: '  使用杂志拼贴与粗线条插画  ',
      }),
    ).toEqual({
      visualStyle: 'custom',
      customVisualStyle: '使用杂志拼贴与粗线条插画',
    })
  })

  it('rejects missing or misplaced custom instructions', () => {
    expect(() =>
      normalizeProjectVisualStyle({ visualStyle: 'custom' }),
    ).toThrow()
    expect(() =>
      normalizeProjectVisualStyle({
        visualStyle: 'flat',
        customVisualStyle: '不能跟随平面预设',
      }),
    ).toThrow()
  })

  it('maps invalid multipart fields to the request boundary error', () => {
    const form = new FormData()
    form.set('visualStyle', 'custom')

    expect(() =>
      readProjectVisualStyleFormData(
        form,
        () => new Error('视觉风格无效'),
      ),
    ).toThrow('视觉风格无效')
  })
})
