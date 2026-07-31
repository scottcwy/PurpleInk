import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import { createDirectorSession, type DirectorTool } from './pi-session'
import { PIPELINE_STAGES } from './types'

const assistantOutput = { kind: 'assistant-text' } as const

const mocks = vi.hoisted(() => {
  const appendMessage = vi.fn()
  const closeStore = vi.fn()
  const buildContext = vi.fn()
  const openStore = vi.fn()
  const publish = vi.fn()
  const createProvider = vi.fn(() => ({}))
  const resolveDirectorModelTarget = vi.fn()
  const recordProviderFailure = vi.fn()
  const recordProviderSuccess = vi.fn()
  const gatewayBegin = vi.fn()
  const gatewaySettle = vi.fn()
  const gatewaySettleUnavailable = vi.fn()
  const gatewayRelease = vi.fn()
  const agentInstances: MockAgent[] = []
  const promptMessages: unknown[][] = []
  const promptModes: Array<'hang'> = []
  const billingProviderFailures: unknown[] = []
  const createDirectorModelStream = vi.fn((input: {
    onProviderFailure?: (error: unknown) => void
  }) => {
    const failure = billingProviderFailures.shift()
    if (failure !== undefined) input.onProviderFailure?.(failure)
    return {}
  })

  class MockAgent {
    readonly listeners: Array<(event: unknown) => Promise<void> | void> = []
    readonly state: {
      systemPrompt: string
      model: unknown
      tools: unknown[]
      messages: unknown[]
      errorMessage?: string
    }
    readonly onResponse?: (response: { status: number }, model: unknown) => Promise<void> | void
    readonly streamFn?: (...args: unknown[]) => unknown
    promptPending = false
    abortCalls = 0
    private rejectPendingPrompt?: (error: Error) => void

    constructor(options: {
      initialState?: {
        systemPrompt?: string
        model?: unknown
        tools?: unknown[]
        messages?: unknown[]
      }
      onResponse?: (response: { status: number }, model: unknown) => Promise<void> | void
      streamFn?: (...args: unknown[]) => unknown
    }) {
      this.state = {
        systemPrompt: options.initialState?.systemPrompt ?? '',
        model: options.initialState?.model,
        tools: options.initialState?.tools ?? [],
        messages: options.initialState?.messages ?? [],
      }
      this.onResponse = options.onResponse
      this.streamFn = options.streamFn
      agentInstances.push(this)
    }

    subscribe(listener: (event: unknown) => Promise<void> | void) {
      this.listeners.push(listener)
      return vi.fn()
    }

    async prompt(prompt: string) {
      if (promptModes.shift() === 'hang') {
        this.promptPending = true
        await new Promise<never>((_resolve, reject) => {
          this.rejectPendingPrompt = reject
        })
      }
      if (billingProviderFailures.length > 0) {
        this.streamFn?.({}, {}, {})
        this.state.errorMessage = 'Provider request failed'
      }
      const messages = promptMessages.shift() ?? [
        { role: 'user', content: [{ type: 'text', text: prompt }], timestamp: 2 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '完成' }],
          timestamp: 3,
          stopReason: 'stop',
          usage: {},
        },
      ]
      // 流式增量：assistant 文本逐步增长（部分 → 完整），触发 message_update。
      for (const partial of ['完', '完成']) {
        for (const listener of this.listeners) {
          await listener({
            type: 'message_update',
            message: { role: 'assistant', content: [{ type: 'text', text: partial }] },
          })
        }
      }
      for (const message of messages) {
        for (const listener of this.listeners) {
          await listener({ type: 'message_end', message })
        }
      }
      this.state.messages.push(...messages)
    }

    async waitForIdle() {}
    abort() {
      this.abortCalls += 1
      this.rejectPendingPrompt?.(new Error('agent aborted'))
      this.rejectPendingPrompt = undefined
      this.promptPending = false
    }
  }

  return {
    appendMessage,
    closeStore,
    buildContext,
    openStore,
    publish,
    createProvider,
    resolveDirectorModelTarget,
    recordProviderFailure,
    recordProviderSuccess,
    gatewayBegin,
    gatewaySettle,
    gatewaySettleUnavailable,
    gatewayRelease,
    agentInstances,
    promptMessages,
    promptModes,
    billingProviderFailures,
    createDirectorModelStream,
    MockAgent,
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/features/ai/provider-dispatch', () => ({
  deferProviderScope: vi.fn(async () => undefined),
  reserveProviderDispatch: vi.fn(async () => ({
    id: 'dispatch-1',
    scopeKey: 'a'.repeat(64),
    release: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/stream/stream-bus', () => ({ streamBus: { publish: mocks.publish } }))
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: mocks.MockAgent }))
vi.mock('./director-gemini-fallback-stream', () => ({
  createDirectorModelStream: mocks.createDirectorModelStream,
}))
vi.mock('@earendil-works/pi-ai', () => ({
  createModels: () => ({ setProvider: vi.fn(), streamSimple: vi.fn() }),
  createProvider: mocks.createProvider,
  envApiKeyAuth: vi.fn(() => ({})),
}))
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: vi.fn(() => ({})),
}))
vi.mock('@earendil-works/pi-ai/api/anthropic-messages.lazy', () => ({
  anthropicMessagesApi: vi.fn(() => ({ anthropicMessages: true })),
}))
vi.mock('@/features/ai/model-routing', () => ({
  DIRECTOR_NODE_TYPES: [
    'script-import',
    'shot-split',
    'score',
    'export',
    'shot-script',
    'shot-codegen',
    'shot-sfx',
    'shot-subtitle',
    'shot-qa',
  ],
  resolveDirectorModelTarget: mocks.resolveDirectorModelTarget,
}))
vi.mock('@/features/ai/provider-breaker', () => ({
  recordProviderFailure: mocks.recordProviderFailure,
  recordProviderSuccess: mocks.recordProviderSuccess,
}))
vi.mock('@/features/ai', () => ({
  ManagedAiGateway: class {
    begin = mocks.gatewayBegin
  },
}))
vi.mock('./session-store', () => ({
  DirectorSessionStore: class {
    open = mocks.openStore
    close = mocks.closeStore
  },
}))

describe('createDirectorSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentInstances.length = 0
    mocks.promptMessages.length = 0
    mocks.promptModes.length = 0
    mocks.billingProviderFailures.length = 0
    mocks.resolveDirectorModelTarget.mockReturnValue({
      provider: 'stepfun',
      baseUrl: 'https://api.stepfun.test/v1',
      modelId: 'step-chat',
      apiKey: 'stepfun-key',
    })
    mocks.gatewayBegin.mockResolvedValue({
      settle: mocks.gatewaySettle,
      settleUnavailable: mocks.gatewaySettleUnavailable,
      releaseBeforeCall: mocks.gatewayRelease,
    })
    mocks.buildContext.mockResolvedValue({
      messages: [{ role: 'user', content: [{ type: 'text', text: '历史消息' }], timestamp: 1 }],
    })
    mocks.openStore.mockResolvedValue({
      id: 'session-1',
      storageKey: 'pi-sessions/project/session.jsonl',
      session: {
        appendMessage: mocks.appendMessage,
        buildContext: mocks.buildContext,
      },
    })
  })

  it('restores context, adapts project tools, and persists message_end once', async () => {
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'FABRICATE',
      resumeSessionKey: 'pi-sessions/project/session.jsonl',
    })
    const tool: DirectorTool = {
      name: 'project_check',
      label: '项目校验',
      description: '只使用项目原生逻辑',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: vi.fn(async () => ({ content: 'ok', details: { ok: true } })),
    }
    const result = await session.run({
      prompt: '执行阶段',
      tools: [tool],
      output: assistantOutput,
    })

    const agent = mocks.agentInstances[0]!
    expect(agent.state.messages[0]).toMatchObject({ role: 'user' })
    expect(agent.state.tools).toHaveLength(1)
    expect(mocks.appendMessage.mock.calls.map(([message]) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(result).toEqual({
      artifactContent: '完成',
      displayText: '完成',
      provenance: { kind: 'assistant-text', timestamp: 3 },
    })
    expect(Object.keys(session).sort()).toEqual(['close', 'id', 'run', 'storageKey'])
    expect(agent.state.systemPrompt).not.toContain('Skill')
  })

  it('aborts an in-flight run with the outer Director signal reason', async () => {
    mocks.promptModes.push('hang')
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'FABRICATE',
    })
    const controller = new AbortController()
    const reason = new Error('queue attempt cancelled')
    const running = session.run({
      prompt: '执行阶段',
      output: assistantOutput,
      signal: controller.signal,
    })
    const agent = mocks.agentInstances[0]!
    await vi.waitFor(() => expect(agent.promptPending).toBe(true))

    controller.abort(reason)

    await expect(running).rejects.toBe(reason)
    expect(agent.abortCalls).toBe(1)
    await session.close()
  })

  it('closes the subscription and session store', async () => {
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    await session.close()
    expect(mocks.closeStore).toHaveBeenCalledOnce()
  })

  it.each(PIPELINE_STAGES)('returns the same project session surface for %s', async (stage) => {
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: `node-${stage.toLowerCase()}`,
      stage,
    })

    expect(Object.keys(session).sort()).toEqual(['close', 'id', 'run', 'storageKey'])
    await session.close()
  })

  it('通过 message_update 捕获流式增量并按 projectId:nodeId 推送事件总线', async () => {
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    await session.run({ prompt: '执行阶段', output: assistantOutput })

    expect(mocks.publish.mock.calls).toEqual([
      ['project-1:node-1', '完'],
      ['project-1:node-1', '成'],
    ])
  })

  it('constructs the selected Gemini runtime from the trusted node type', async () => {
    mocks.resolveDirectorModelTarget.mockReturnValueOnce({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      modelId: 'gemini-3.6-flash',
      apiKey: 'gemini-key',
    })

    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      nodeType: 'shot-codegen',
      stage: 'FABRICATE',
    })

    expect(mocks.resolveDirectorModelTarget).toHaveBeenCalledWith(
      'shot-codegen',
      'text'
    )
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        api: {},
        models: [
          expect.objectContaining({
            id: 'gemini-3.6-flash',
            provider: 'gemini',
            api: 'openai-completions',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          }),
        ],
      })
    )
    await session.close()
  })

  it('separates validated Tool arguments from display text and omits thinking from storage', async () => {
    mocks.promptMessages.push([
      {
        role: 'user',
        content: [{ type: 'text', text: '执行阶段' }],
        timestamp: 2,
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '不得持久化的隐藏推理' },
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'validate_shot_plan',
            arguments: { shotPlan: { schemaVersion: 1, shots: [] } },
          },
        ],
        timestamp: 3,
        stopReason: 'toolUse',
        usage: {},
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'validate_shot_plan',
        content: [{ type: 'text', text: '{"ok":true}' }],
        details: { ok: true },
        isError: false,
        timestamp: 4,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '完成' }],
        timestamp: 5,
        stopReason: 'stop',
        usage: {},
      },
    ])
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'SHOT_SPEC',
    })

    const result = await session.run({
      prompt: '执行阶段',
      output: {
        kind: 'validated-tool-argument',
        toolName: 'validate_shot_plan',
        argumentKey: 'shotPlan',
      },
    })

    expect(result).toEqual({
      artifactContent: '{"schemaVersion":1,"shots":[]}',
      displayText: '完成',
      provenance: {
        kind: 'tool-argument',
        toolName: 'validate_shot_plan',
        toolCallId: 'call-1',
      },
    })
    expect(JSON.stringify(mocks.appendMessage.mock.calls)).not.toContain(
      '不得持久化的隐藏推理'
    )
  })

  it('does not reuse a successful Tool result from restored history', async () => {
    mocks.buildContext.mockResolvedValueOnce({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'old-call',
              name: 'validate_shot_plan',
              arguments: { shotPlan: { stale: true } },
            },
          ],
        },
        {
          role: 'toolResult',
          toolCallId: 'old-call',
          toolName: 'validate_shot_plan',
          content: [{ type: 'text', text: '{"ok":true}' }],
          details: { ok: true },
          isError: false,
        },
      ],
    })
    mocks.promptMessages.push([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'new-call',
            name: 'validate_shot_plan',
            arguments: { shotPlan: { current: true } },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'new-call',
        toolName: 'validate_shot_plan',
        content: [{ type: 'text', text: '{"ok":false}' }],
        details: { ok: false },
        isError: false,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '仍然完成' }],
      },
    ])
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'SHOT_SPEC',
    })

    await expect(
      session.run({
        prompt: '执行阶段',
        output: {
          kind: 'validated-tool-argument',
          toolName: 'validate_shot_plan',
          argumentKey: 'shotPlan',
        },
      })
    ).rejects.toMatchObject({
      code: 'DIRECTOR_TOOL_OUTPUT_MISSING',
    })
  })

  it('fails explicitly instead of falling back when the selected provider has no key', async () => {
    mocks.resolveDirectorModelTarget.mockReturnValueOnce({
      provider: 'gemini',
      baseUrl: 'https://gemini.test/openai/',
      modelId: 'gemini-3.6-flash',
      apiKey: null,
    })

    await expect(
      createDirectorSession({
        projectId: 'project-1',
        nodeId: 'node-1',
        nodeType: 'shot-codegen',
        stage: 'FABRICATE',
      })
    ).rejects.toThrow('Gemini API Key 未配置')
    expect(mocks.closeStore).toHaveBeenCalledOnce()
  })

  /**
   * 阶段 4（模式 H）：熔断记账的单一收敛点在本会话的 run 结果处——
   * 只有真实发生过的外部模型调用成败/失败才计入，内部矛盾不得污染计数。
   */
  it('records a provider success on a completed model run', async () => {
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    await session.run({ prompt: '执行阶段', output: assistantOutput })

    expect(mocks.recordProviderSuccess).toHaveBeenCalledWith('stepfun')
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
  })

  it('does not pollute the breaker with a provider account failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    mocks.agentInstances[0]!.state.errorMessage = 'provider request rejected'
    await mocks.agentInstances[0]!.onResponse?.({ status: 402 }, {})

    await expect(
      session.run({ prompt: '执行阶段', output: assistantOutput })
    ).rejects.toMatchObject({
      name: 'ProviderRequestError',
      httpStatus: 402,
      kind: 'balance',
    })
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
    expect(mocks.recordProviderSuccess).not.toHaveBeenCalled()
  })

  it('preserves an observed HTTP status when Agent.prompt rejects before idle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    const agent = mocks.agentInstances[0]!
    agent.state.errorMessage = 'Provider request failed'
    await agent.onResponse?.({ status: 402 }, {})
    vi.spyOn(agent, 'prompt').mockRejectedValueOnce(new Error('Provider request failed'))

    await expect(
      session.run({ prompt: '执行阶段', output: assistantOutput })
    ).rejects.toMatchObject({
      name: 'ProviderRequestError',
      httpStatus: 402,
      kind: 'balance',
    })
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
    expect(mocks.recordProviderSuccess).not.toHaveBeenCalled()
  })

  it.each([429, 451])('does not pollute the breaker with HTTP %s', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    const agent = mocks.agentInstances[0]!
    agent.state.errorMessage = `HTTP ${status}`
    await agent.onResponse?.({ status }, {})
    await expect(
      session.run({ prompt: '执行阶段', output: assistantOutput })
    ).rejects.toMatchObject({ name: 'ProviderRequestError', httpStatus: status })
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
  })

  it('records a breaker failure for a real provider 503 outage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    const agent = mocks.agentInstances[0]!
    agent.state.errorMessage = 'HTTP 503'
    await agent.onResponse?.({ status: 503 }, {})
    await expect(
      session.run({ prompt: '执行阶段', output: assistantOutput })
    ).rejects.toMatchObject({ name: 'ProviderRequestError', kind: 'unavailable' })
    expect(mocks.recordProviderFailure).toHaveBeenCalledWith('stepfun')
  })

  it('preserves a typed provider timeout through the workflow fault projection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const timeout = new ProviderRequestError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: 'Director',
      funding: 'managed',
      kind: 'timeout',
    })
    mocks.billingProviderFailures.push(timeout)
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })

    const failure = await session
      .run({ prompt: '执行阶段', output: assistantOutput })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBe(timeout)
    expect(mocks.recordProviderFailure).toHaveBeenCalledWith('stepfun')
    expect(classifyWorkflowError(failure, { stage: 'INGEST' })).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
      provider: {
        id: 'stepfun',
        label: '阶跃星辰',
      },
    })
  })

  it('keeps a pi-formatted 4xx status while discarding the provider body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await createDirectorSession({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })
    mocks.agentInstances[0]!.state.errorMessage = '402: {"providerDetail":"must-not-leak"}'

    const failure = await session.run({ prompt: '执行阶段', output: assistantOutput })
      .then(() => null, (error: unknown) => error)
    const message = failure instanceof Error ? failure.message : String(failure)

    expect(failure).toMatchObject({
      name: 'ProviderRequestError',
      httpStatus: 402,
      kind: 'balance',
    })
    expect(message).not.toContain('providerDetail')
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
  })

  it('does not count an internal route contract contradiction against the breaker', async () => {
    // 纯音频端点无法承担文本会话是设置面矛盾（RouteContractError），
    // 不是外部故障：若计入熔断，一条配置错误就会把健康的 provider 熏成不可用。
    mocks.resolveDirectorModelTarget.mockReturnValueOnce({
      provider: 'openai-compatible-tts',
      baseUrl: 'https://audio.test/v1',
      modelId: 'tts-1',
      apiKey: 'audio-key',
    })

    await expect(
      createDirectorSession({
        projectId: 'project-1',
        nodeId: 'node-1',
        nodeType: 'shot-codegen',
        stage: 'FABRICATE',
      })
    ).rejects.toMatchObject({ name: 'RouteContractError' })
    expect(mocks.recordProviderFailure).not.toHaveBeenCalled()
    expect(mocks.recordProviderSuccess).not.toHaveBeenCalled()
  })
})
