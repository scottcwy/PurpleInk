import { describe, expect, it } from 'vitest'
import {
  extractDirectorOutput,
  type DirectorAgentMessage as AgentMessage,
} from './pi-output'

const toolPolicy = {
  kind: 'validated-tool-argument',
  toolName: 'validate_shot_plan',
  argumentKey: 'shotPlan',
} as const

function asMessages(messages: readonly unknown[]): AgentMessage[] {
  return messages as AgentMessage[]
}

function toolTranscript(overrides: Record<string, unknown> = {}): AgentMessage[] {
  return asMessages([
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '不得进入任何输出' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'validate_shot_plan',
          arguments: { shotPlan: { schemaVersion: 1, shots: [] } },
        },
      ],
    },
    {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'validate_shot_plan',
      content: [{ type: 'text', text: '{"ok":true}' }],
      details: { ok: true, shotCount: 0 },
      isError: false,
      ...overrides,
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: '完成' }],
    },
  ])
}

function captureError(run: () => unknown): Error & { code?: string } {
  try {
    run()
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error('输出提取抛出了非 Error 值')
  }
  throw new Error('预期输出提取失败')
}

describe('extractDirectorOutput', () => {
  it('reconstructs the validated Tool argument instead of trailing assistant text', () => {
    const result = extractDirectorOutput(toolTranscript(), toolPolicy)

    expect(result).toEqual({
      artifactContent: '{"schemaVersion":1,"shots":[]}',
      displayText: '完成',
      provenance: {
        kind: 'tool-argument',
        toolName: 'validate_shot_plan',
        toolCallId: 'call-1',
      },
    })
    expect(JSON.stringify(result)).not.toContain('不得进入任何输出')
  })

  it.each([
    ['errored result', { isError: true }],
    ['failed validation', { details: { ok: false, errors: ['invalid'] } }],
    ['different Tool', { toolName: 'other_tool' }],
  ])('rejects an %s without falling back to assistant text', (_label, overrides) => {
    const error = captureError(() =>
      extractDirectorOutput(toolTranscript(overrides), toolPolicy)
    )

    expect(error.code).toBe('DIRECTOR_TOOL_OUTPUT_MISSING')
    expect(error.message).toContain('validate_shot_plan')
  })

  it.each([
    ['name', 'other_tool', 'call-1'],
    ['id', 'validate_shot_plan', 'other-call'],
  ])('rejects a Tool call with a mismatched %s', (_label, name, id) => {
    const messages = toolTranscript()
    const assistant = messages[0]
    if (assistant?.role === 'assistant') {
      const toolCall = assistant.content.find((item) => item.type === 'toolCall')
      if (toolCall?.type === 'toolCall') {
        toolCall.name = name
        toolCall.id = id
      }
    }

    const error = captureError(() =>
      extractDirectorOutput(messages, toolPolicy)
    )
    expect(error).toMatchObject({ code: 'DIRECTOR_TOOL_OUTPUT_MISSING' })
  })

  it('returns only the last non-empty assistant text with its timestamp', () => {
    const result = extractDirectorOutput(
      asMessages([
        {
          role: 'assistant',
          content: [{ type: 'text', text: '初稿' }],
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '  最终展示  ' }],
          timestamp: 2,
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '隐藏推理' },
            { type: 'text', text: '   ' },
          ],
          timestamp: 3,
        },
      ]),
      { kind: 'assistant-text' }
    )

    expect(result).toEqual({
      artifactContent: '最终展示',
      displayText: '最终展示',
      provenance: { kind: 'assistant-text', timestamp: 2 },
    })
    expect(JSON.stringify(result)).not.toContain('隐藏推理')
  })

  it('preserves a string Tool argument byte-for-byte and permits empty display text', () => {
    const source = '<html>\r\n  <body>镜头</body>\r\n</html>'
    const result = extractDirectorOutput(
      asMessages([
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-source',
              name: 'check_determinism',
              arguments: { source },
            },
          ],
        },
        {
          role: 'toolResult',
          toolCallId: 'call-source',
          toolName: 'check_determinism',
          content: [{ type: 'text', text: '{"ok":true}' }],
          details: { ok: true },
          isError: false,
        },
      ]),
      {
        kind: 'validated-tool-argument',
        toolName: 'check_determinism',
        argumentKey: 'source',
      }
    )

    expect(result.artifactContent).toBe(source)
    expect(result.displayText).toBe('')
  })

  it('recovers a validated argument the model emitted as assistant text', () => {
    const result = extractDirectorOutput(
      asMessages([
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '隐藏推理' },
            { type: 'text', text: '{"shotPlan":{"schemaVersion":1,"shots":[]}}' },
          ],
        },
      ]),
      { ...toolPolicy, recover: (text) => JSON.parse(text).shotPlan && '恢复内容' }
    )

    expect(result).toEqual({
      artifactContent: '恢复内容',
      displayText: '{"shotPlan":{"schemaVersion":1,"shots":[]}}',
      provenance: {
        kind: 'assistant-text-recovery',
        toolName: 'validate_shot_plan',
      },
    })
    expect(JSON.stringify(result)).not.toContain('隐藏推理')
  })

  it('prefers the validated Tool argument over the recovery path', () => {
    const result = extractDirectorOutput(toolTranscript(), {
      ...toolPolicy,
      recover: () => '不应被使用',
    })

    expect(result.artifactContent).toBe('{"schemaVersion":1,"shots":[]}')
    expect(result.provenance).toMatchObject({ kind: 'tool-argument' })
  })

  it('still fails when the recovery validator rejects the assistant text', () => {
    const error = captureError(() =>
      extractDirectorOutput(toolTranscript({ isError: true }), {
        ...toolPolicy,
        recover: () => null,
      })
    )

    expect(error.code).toBe('DIRECTOR_TOOL_OUTPUT_MISSING')
  })

  it('does not attempt recovery when there is no assistant text', () => {
    let called = false
    const error = captureError(() =>
      extractDirectorOutput(asMessages([]), {
        ...toolPolicy,
        recover: () => {
          called = true
          return '不应被调用'
        },
      })
    )

    expect(error.code).toBe('DIRECTOR_TOOL_OUTPUT_MISSING')
    expect(called).toBe(false)
  })

  it('rejects a missing or unserializable Tool argument explicitly', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    for (const argumentsValue of [
      {},
      { shotPlan: undefined },
      { shotPlan: circular },
    ]) {
      const messages = toolTranscript()
      const assistant = messages[0]
      if (assistant?.role === 'assistant') {
        const toolCall = assistant.content.find((item) => item.type === 'toolCall')
        if (toolCall?.type === 'toolCall') toolCall.arguments = argumentsValue
      }
      const error = captureError(() =>
        extractDirectorOutput(messages, toolPolicy)
      )
      expect(error).toMatchObject({
        code: 'DIRECTOR_TOOL_OUTPUT_MISSING',
      })
      expect(error.message).toContain('validate_shot_plan')
    }
  })
})
