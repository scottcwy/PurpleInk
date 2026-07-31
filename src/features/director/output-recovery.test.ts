import { describe, expect, it } from 'vitest'
import {
  recoverDeterministicSourceArgument,
  recoverShotPlanArgument,
  stripCodeFences,
} from './output-recovery'

const validPlan = { schemaVersion: 1, title: '演示', shots: [{ id: 'S001' }] }

describe('stripCodeFences', () => {
  it('unwraps a fenced block and keeps the inner bytes intact', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFences('```\n<html>\r\n</html>\n```')).toBe('<html>\r\n</html>')
  })

  it('returns the trimmed text when there is no fence', () => {
    expect(stripCodeFences('  {"a":1}  ')).toBe('{"a":1}')
  })

  it('leaves an unterminated fence untouched apart from trimming', () => {
    expect(stripCodeFences('```json\n{"a":1}')).toBe('```json\n{"a":1}')
  })
})

describe('recoverShotPlanArgument', () => {
  it('accepts the tool argument envelope and returns the shotPlan value', () => {
    expect(recoverShotPlanArgument(JSON.stringify({ shotPlan: validPlan }))).toBe(
      JSON.stringify(validPlan)
    )
  })

  it('accepts a bare shot plan object', () => {
    expect(recoverShotPlanArgument(JSON.stringify(validPlan))).toBe(
      JSON.stringify(validPlan)
    )
  })

  it('accepts a fenced payload', () => {
    expect(
      recoverShotPlanArgument('```json\n' + JSON.stringify(validPlan) + '\n```')
    ).toBe(JSON.stringify(validPlan))
  })

  it('preserves keys the loose runtime schema does not model', () => {
    const rich = {
      schemaVersion: 1,
      shots: [{ id: 'S001', responsibility: '引入', mustShow: ['标题'] }],
    }
    expect(recoverShotPlanArgument(JSON.stringify(rich))).toBe(JSON.stringify(rich))
  })

  it.each([
    ['non-JSON prose', '这是一段说明文字'],
    ['an array', '[]'],
    ['a plan without shots', JSON.stringify({ schemaVersion: 1, shots: [] })],
    [
      'a shot with an invalid id',
      JSON.stringify({ schemaVersion: 1, shots: [{ id: '1' }] }),
    ],
    [
      'a wrong schemaVersion',
      JSON.stringify({ schemaVersion: 2, shots: [{ id: 'S001' }] }),
    ],
  ])('rejects %s', (_label, text) => {
    expect(recoverShotPlanArgument(text)).toBeNull()
  })
})

describe('recoverDeterministicSourceArgument', () => {
  it('accepts a complete HTML document', () => {
    expect(recoverDeterministicSourceArgument('<html><body>镜头</body></html>')).toBe(
      '<html><body>镜头</body></html>'
    )
  })

  it('accepts a fenced HTML document and preserves inner bytes', () => {
    expect(
      recoverDeterministicSourceArgument('```html\n<html>\r\n</html>\n```')
    ).toBe('<html>\r\n</html>')
  })

  it('unwraps an OpenAI-compatible textual check_determinism call', () => {
    const wrapped = [
      '<tool_call>',
      '<function=check_determinism>',
      '<parameter=source>',
      '<!doctype html><html><body>镜头</body></html>',
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n')

    expect(recoverDeterministicSourceArgument(wrapped)).toBe(
      '<!doctype html><html><body>镜头</body></html>'
    )
  })

  it('rejects a truncated textual tool call', () => {
    expect(
      recoverDeterministicSourceArgument(
        '<tool_call><function=check_determinism><parameter=source><html>'
      )
    ).toBeNull()
  })

  it.each([
    ['prose', '这是一段说明文字'],
    ['an empty payload', '   '],
    ['a JSON payload', '{"source":"<html></html>"}'],
  ])('rejects %s', (_label, text) => {
    expect(recoverDeterministicSourceArgument(text)).toBeNull()
  })
})
