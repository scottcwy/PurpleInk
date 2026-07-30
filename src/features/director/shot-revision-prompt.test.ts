import { describe, expect, it } from 'vitest'
import { appendShotRevisionContext } from './shot-revision-prompt'

describe('appendShotRevisionContext', () => {
  it('keeps the standard prompt byte-for-byte when no revision was requested', () => {
    expect(appendShotRevisionContext('标准 FABRICATE 合同')).toBe(
      '标准 FABRICATE 合同',
    )
  })

  it('provides the complete prior HTML and limits the model to a local edit', () => {
    const sourceHtml =
      '<!doctype html><html><style>.title{color:red}</style><h1>旧标题</h1></html>'
    const prompt = appendShotRevisionContext(
      '标准 FABRICATE 合同',
      {
        revisionBrief: '  主视觉改成俯视构图，标题更克制  ',
        sourceHtml,
      },
    )

    expect(prompt).toContain(JSON.stringify(sourceHtml))
    expect(prompt).toContain('"主视觉改成俯视构图，标题更克制"')
    expect(prompt.indexOf('基于旧稿局部修订')).toBeGreaterThan(
      prompt.indexOf('标准 FABRICATE 合同'),
    )
    expect(prompt).toContain('以 previousHtml 为唯一编辑底稿')
    expect(prompt).toContain('只修改满足 revisionBrief 所必需的最小')
    expect(prompt).toContain('必须保持旧稿不变')
    expect(prompt).toContain('shot contract')
    expect(prompt).toContain('确定性规则冲突')
    expect(prompt).toContain('输出修改后的完整自包含 HTML')
  })

  it('rejects an empty source or invalid revision brief', () => {
    expect(() =>
      appendShotRevisionContext('base', {
        revisionBrief: '   ',
        sourceHtml: '<html></html>',
      }),
    ).toThrow('请输入修改要求')
    expect(() =>
      appendShotRevisionContext('base', {
        revisionBrief: '改'.repeat(201),
        sourceHtml: '<html></html>',
      }),
    ).toThrow('修改要求不能超过 200 字')
    expect(() =>
      appendShotRevisionContext('base', {
        revisionBrief: '改成蓝色',
        sourceHtml: '   ',
      }),
    ).toThrow('分镜修改缺少现有 HTML')
  })
})
