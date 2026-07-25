/** 对话消息（OpenAI 兼容）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

/** LLM 提供方适配器。Demo 用 StepFun（OpenAI 兼容）。 */
export interface LlmAdapter {
  /** 单轮 / 多轮对话补全，返回文本。 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
}
