import 'server-only'
import { Agent } from '@earendil-works/pi-agent-core'
import { ManagedAiGateway } from '@/features/ai'
import {
  recordProviderFailure,
  recordProviderSuccess,
} from '@/features/ai/provider-breaker'
import { storage } from '@/lib/storage'
import {
  extractDirectorOutput,
  type DirectorOutput,
  type DirectorOutputPolicy,
} from './pi-output'
import { createDirectorModelRuntime } from './pi-provider'
import { createDirectorRunBridge } from './pi-stream-bridge'
import { createDirectorBillingStream } from './director-billing-stream'
import { adaptDirectorTools } from './pi-tool-adapter'
import { DirectorSessionStore } from './session-store'
import type { PipelineStage } from './types'

export interface DirectorToolResult {
  content: string
  details?: unknown
  terminate?: boolean
}

export interface DirectorTool {
  name: string
  label: string
  description: string
  parameters: Readonly<Record<string, unknown>>
  execute: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<DirectorToolResult>
}

export interface DirectorRunInput {
  prompt: string
  tools?: readonly DirectorTool[]
  output: DirectorOutputPolicy
}

export type DirectorRunResult = DirectorOutput

export interface DirectorSession {
  id: string
  storageKey: string
  run(input: DirectorRunInput): Promise<DirectorRunResult>
  close(): Promise<void>
}

export interface DirectorSessionInput {
  projectId: string
  nodeId: string
  attemptId?: string
  nodeType?: string | null
  stage: PipelineStage
  resumeSessionKey?: string
}

class DirectorRunError extends Error {
  readonly code = 'DIRECTOR_RUN_FAILED'

  constructor(routeLabel: string, httpStatus: number | null) {
    const status = httpStatus === null ? '' : `，HTTP ${httpStatus}`
    super(`Director 模型调用失败（${routeLabel}${status}）`)
    this.name = 'DirectorRunError'
  }
}

/**
 * 装配一次 Director 会话：JSONL 会话存储 + 选型后的 pi Provider + Agent 事件桥。
 *
 * 会话恢复走 `Session.buildContext()`，输出提取只看本轮消息；
 * 选型缺 Key 时立即失败并关闭已开的会话存储，不做任何兜底。
 */
export async function createDirectorSession(
  input: DirectorSessionInput,
): Promise<DirectorSession> {
  const store = new DirectorSessionStore(storage)
  const stored = await store.open(input)
  try {
    const runtime = await createDirectorModelRuntime({
      nodeType: input.nodeType,
      stage: input.stage,
    })
    const restored = await stored.session.buildContext()
    const bridge = createDirectorRunBridge({
      streamKey: `${input.projectId}:${input.nodeId}`,
      appendMessage: (message) => stored.session.appendMessage(message),
    })
    let upstreamFailureStatus: number | null = null
    const gateway = new ManagedAiGateway()
    let invocationIndex = 0
    let preflightFailure: unknown
    const agent = new Agent({
      initialState: {
        systemPrompt: buildDirectorSystemPrompt(input.stage),
        model: runtime.model,
        messages: [...restored.messages],
        tools: [],
      },
      streamFn: (model, context, options) => {
        preflightFailure = undefined
        return createDirectorBillingStream({
          model,
          context,
          options,
          runtime,
          attemptId: input.attemptId,
          invocationIndex: ++invocationIndex,
          gateway,
          onPreflightFailure: (error) => {
            preflightFailure = error
          },
          streamSimple: (nextModel, nextContext, nextOptions) =>
            runtime.models.streamSimple(nextModel, nextContext, nextOptions),
        })
      },
      getApiKey: () => runtime.apiKey,
      onResponse: (response) => {
        if (response.status >= 400 && response.status <= 599) {
          upstreamFailureStatus = response.status
        }
      },
    })
    const unsubscribe = agent.subscribe(bridge.listener)
    let closed = false
    return {
      id: stored.id,
      storageKey: stored.storageKey,
      run: async (runInput) => {
        bridge.beginRun()
        agent.state.tools = adaptDirectorTools(runInput.tools)
        try {
          await agent.prompt(runInput.prompt)
          await agent.waitForIdle()
          if (preflightFailure !== undefined) throw preflightFailure
          assertRunSucceeded(agent, runtime, upstreamFailureStatus)
          return extractDirectorOutput(bridge.runMessages(), runInput.output)
        } catch (error) {
          if (preflightFailure !== undefined) throw preflightFailure
          // pi 在部分流式失败中会从 prompt() 直接 reject，而不会走到下方
          // assertRunSucceeded。只要本次请求已观察到 HTTP 状态或 Agent 已投影
          // 为 provider error，仍必须收敛成稳定的 DirectorRunError，避免让 4xx
          // 被重试策略当作未知瞬态错误。
          if (
            !(error instanceof DirectorRunError) &&
            (upstreamFailureStatus !== null || Boolean(agent.state.errorMessage))
          ) {
            throwDirectorRunFailure(agent, runtime, upstreamFailureStatus)
          }
          throw error
        }
      },
      close: async () => {
        if (closed) return
        closed = true
        agent.abort()
        unsubscribe()
        await store.close()
      },
    }
  } catch (error) {
    await store.close()
    throw error
  }
}

/**
 * 供应商原始错误不进入业务错误面（会落到节点 directorError 并显示给用户），
 * 只在服务端日志留分类信息，对外给稳定的类别文案。
 *
 * 这里同时是熔断记账的**单一收敛点**（模式 H 阶段 4）：只有真实发生过的
 * 外部模型调用才会走到这里——RouteContractError 等内部矛盾在会话装配阶段
 * （createDirectorModelRuntime）就已抛出，永远到不了记账点；模型响应后的
 * 输出解析失败也不计入（provider 本身是健康的）。
 */
function assertRunSucceeded(
  agent: Agent,
  runtime: { providerId: string; routeLabel: string },
  responseStatus: number | null,
): void {
  const errorMessage = agent.state.errorMessage
  if (!errorMessage) {
    recordProviderSuccess(runtime.providerId)
    return
  }
  throwDirectorRunFailure(agent, runtime, responseStatus)
}

function throwDirectorRunFailure(
  agent: Agent,
  runtime: { providerId: string; routeLabel: string },
  responseStatus: number | null,
): never {
  recordProviderFailure(runtime.providerId)
  console.error('[director] 模型调用失败', {
    route: runtime.routeLabel,
    code: 'DIRECTOR_RUN_FAILED',
  })
  throw new DirectorRunError(
    runtime.routeLabel,
    responseStatus ?? upstreamHttpStatus(agent.state.errorMessage ?? ''),
  )
}

/** 仅保留上游 HTTP 状态码，不能把 provider 原始报文带入工作流错误面。 */
function upstreamHttpStatus(message: string): number | null {
  const labeled = /\b(?:HTTP|status(?:\s*code)?)\s*[:=]?\s*([45]\d{2})\b/i.exec(message)
  // pi 的 OpenAI 兼容适配器会把 SDK 的 `error.status` 格式化成
  // `402: <provider body>`。该正文绝不能进入工作流错误面，但状态码必须
  // 保留下来，才能把配置/额度类 4xx 交给不可重试分类器。
  const prefixed = /^\s*([45]\d{2})\s*:/.exec(message)
  const status = labeled?.[1] ?? prefixed?.[1]
  return status ? Number(status) : null
}

/** 会话级角色约束。阶段任务本体由 `stage-prompt.ts` 的 prompt builder 提供。 */
function buildDirectorSystemPrompt(stage: PipelineStage): string {
  return [
    `你是 PurpleInk 的视频导演智能体，当前执行 ${stage} 阶段。`,
    '本轮提供了工具时：最终结果必须通过工具调用提交，不要把工具实参当作普通文本输出；工具返回校验失败就按错误信息修订后再次调用同一工具。',
    '本轮未提供工具时：严格遵守用户消息里的输出格式要求，要求返回 JSON 就只返回 JSON，不要 Markdown 代码围栏。',
    '不要编造原稿之外的事实，不要输出推理过程、凭据或工具参数之外的解释。',
  ].join('\n')
}
