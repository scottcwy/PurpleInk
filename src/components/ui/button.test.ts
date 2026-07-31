import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button loading state', () => {
  it('loading=true 时强制 disabled、aria-busy 并渲染 spinner', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { loading: true }, '创建中…'),
    )

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('animate-spin')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('创建中…')
  })

  it('默认（不传 loading）不 disabled、无 spinner，零影响现有调用点', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, null, '新建项目'),
    )

    // BASE class 含 disabled: 变体前缀，因此断言真实 HTML 属性而非子串。
    expect(markup).not.toContain('disabled=""')
    expect(markup).not.toContain('aria-busy')
    expect(markup).not.toContain('animate-spin')
    expect(markup).toContain('新建项目')
  })

  it('loading 时 spinner 占用图标槽位，替代传入的 icon', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Button,
        { loading: true, icon: () => createElement('svg', { 'data-x': 'i' }) },
        '生成中…',
      ),
    )

    expect(markup).toContain('animate-spin')
    expect(markup).not.toContain('data-x="i"')
  })
})
