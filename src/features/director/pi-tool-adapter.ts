import 'server-only'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { TSchema } from '@earendil-works/pi-ai'
import type { DirectorTool } from './pi-session'

/**
 * 把项目原生 DirectorTool 适配成 pi 的 AgentTool。
 *
 * 两处形状差异需要转换：
 * 1. 参数 schema：项目用纯 JSON Schema 对象，pi 的类型签名要求 TypeBox `TSchema`。
 *    pi 的 `validateToolArguments` 显式支持"没有 TypeBox Kind 符号"的纯 JSON Schema
 *    （见 pi-ai `utils/validation.js`），因此这里只做类型转换，不重写 schema。
 * 2. execute 签名：项目是 `(input, signal)`，pi 是 `(toolCallId, params, signal, onUpdate)`；
 *    返回值的 content 从字符串包成 pi 的 TextContent 数组。
 */
export function adaptDirectorTool(tool: DirectorTool): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: toTypeBoxSchema(tool.parameters),
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> => {
      const result = await tool.execute(params, signal)
      return {
        content: [{ type: 'text', text: result.content }],
        details: result.details,
        ...(result.terminate === undefined ? {} : { terminate: result.terminate }),
      }
    },
  }
}

export function adaptDirectorTools(
  tools: readonly DirectorTool[] = [],
): AgentTool[] {
  return tools.map(adaptDirectorTool)
}

/**
 * 纯 JSON Schema 与 TypeBox schema 在运行时是同一种数据（TypeBox 只多一个 Kind 符号），
 * pi 的校验器对两者都能编译，所以这里只需要打开类型通道，不产生新的 schema 真值。
 */
function toTypeBoxSchema(parameters: Readonly<Record<string, unknown>>): TSchema {
  return parameters as unknown as TSchema
}
