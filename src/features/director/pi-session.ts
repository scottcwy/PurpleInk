import 'server-only'
import { Agent } from '@earendil-works/pi-agent-core'
import { storage } from '@/lib/storage'
import {
  extractDirectorOutput,
  type DirectorOutput,
  type DirectorOutputPolicy,
} from './pi-output'
import { createDirectorModelRuntime } from './pi-provider'
import { createDirectorRunBridge } from './pi-stream-bridge'
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
  nodeType?: string | null
  stage: PipelineStage
  resumeSessionKey?: string
}

class DirectorRunError extends Error {
  readonly code = 'DIRECTOR_RUN_FAILED'

  constructor(routeLabel: string) {
    super(`Director 模型调用失败（${routeLabel}）`)
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
    const agent = new Agent({
      initialState: {
        systemPrompt: buildDirectorSystemPrompt(input.stage),
        model: runtime.model,
        messages: [...restored.messages],
        tools: [],
      },
      streamFn: (model, context, options) =>
        runtime.models.streamSimple(model, context, options),
      getApiKey: () => runtime.apiKey,
    })
    const unsubscribe = agent.subscribe(bridge.listener)
    let closed = false
    return {
      id: stored.id,
      storageKey: stored.storageKey,
      run: async (runInput) => {
        bridge.beginRun()
        agent.state.tools = adaptDirectorTools(runInput.tools)
        await agent.prompt(runInput.prompt)
        await agent.waitForIdle()
        assertRunSucceeded(agent, runtime.routeLabel)
        return extractDirectorOutput(bridge.runMessages(), runInput.output)
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
 */
function assertRunSucceeded(agent: Agent, routeLabel: string): void {
  const errorMessage = agent.state.errorMessage
  if (!errorMessage) return
  console.error('[director] 模型调用失败', { route: routeLabel, errorMessage })
  throw new DirectorRunError(routeLabel)
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
