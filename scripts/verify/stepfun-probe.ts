/**
 * 阶跃星辰调用失败的分层归因探针（一次性诊断脚本）。
 *
 * 目的是把「失败」拆成互斥的几类，避免把余额、模型 ID、请求形状、协议适配混成
 * 一句「调用失败」：
 *
 *   L1 凭据解密        —— 加密存储能否取回 Key（不回显 Key 本身）
 *   L2 端点可达        —— GET /models，顺带看服务端是否列出我们配置的模型 ID
 *   L3 最小补全        —— 与 bootstrap 校验同形状的请求，确认 Key + 模型可用
 *   L4 maxTokens 上限  —— 逐级抬高 max_tokens，定位对端真实上限
 *   L5 视觉模型        —— 带图片的多模态请求（Vision QA 走这条）
 *   L6 结构化输出      —— response_format / tools，Director 依赖的能力
 *   L7 长上下文        —— 逼近 REQUEST_SHAPE.stepfun 的 contextWindow
 *
 * 纪律：只打印状态码与对端错误文案里的**错误类型字段**，不回显 Key，
 * 不回显完整 response body（可能含账号信息）。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = require.resolve('../setup/server-only-stub.js')
  const Module = require('node:module') as typeof import('node:module')
  const target = Module as unknown as {
    _resolveFilename: (...args: unknown[]) => string
  }
  const original = target._resolveFilename
  target._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

installServerOnlyShim()

interface Outcome {
  layer: string
  ok: boolean
  detail: string
}

const results: Outcome[] = []

function record(layer: string, ok: boolean, detail: string): void {
  results.push({ layer, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${layer} — ${detail}`)
}

/** 从对端响应里只摘错误类型与消息，丢掉其余字段。 */
async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  let message = text.slice(0, 400)
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown; type?: unknown; code?: unknown }
    }
    if (parsed.error) {
      message = JSON.stringify({
        type: parsed.error.type,
        code: parsed.error.code,
        message: parsed.error.message,
      })
    }
  } catch {
    // 非 JSON，保留截断后的原文
  }
  return `HTTP ${response.status} ${message}`
}

async function main(): Promise<void> {
  const [
    { loadEnvConfig },
    { resolveDeploymentBinding },
    { resolveManagedCredential },
  ] = await Promise.all([
    import('@next/env'),
    import('@/features/ai/execution-plan'),
    import('@/features/ai/managed-credentials'),
  ])
  loadEnvConfig(process.cwd())

  // L1 凭据解密
  const binding = (capability: 'text' | 'vision' | 'tts' | 'asr') =>
    resolveDeploymentBinding({
      providerId: 'stepfun',
      fundingSource: 'managed',
      capability,
    })
  const text = binding('text')
  const vision = binding('vision')
  const tts = binding('tts')
  const asr = binding('asr')
  const apiKey = resolveManagedCredential('stepfun')
  const baseUrl = text.baseUrl.replace(/\/+$/, '')
  if (!apiKey) {
    record('L1 托管凭据', false, '缺少 StepFun managed secretRef 对应的环境变量')
    return
  }
  record(
    'L1 托管凭据',
    true,
    `managed credential configured；chat=${text.outboundModelId} `
    + `vision=${vision.outboundModelId} tts=${tts.outboundModelId} `
    + `asr=${asr.outboundModelId}`,
  )
  const authHeaders = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }

  // L2 端点可达 + 模型清单
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      record('L2 GET /models', false, await describeFailure(response))
    } else {
      const body = (await response.json()) as { data?: Array<{ id?: string }> }
      const ids = (body.data ?? []).map((item) => item.id).filter(Boolean) as string[]
      const wanted = [
        text.outboundModelId,
        vision.outboundModelId,
        tts.outboundModelId,
        asr.outboundModelId,
      ]
      const missing = wanted.filter((id) => !ids.includes(id))
      record(
        'L2 GET /models',
        missing.length === 0,
        missing.length === 0
          ? `对端列出 ${ids.length} 个模型，配置的 4 个都在清单里`
          : `对端列出 ${ids.length} 个模型，**清单里没有**：${missing.join(', ')}`,
      )
      console.log(`     清单节选：${ids.slice(0, 20).join(', ')}`)
    }
  } catch (error) {
    record('L2 GET /models', false, `${(error as Error).name}: ${(error as Error).message}`)
  }

  // L3 最小补全：保持与 OpenAI-compatible 文本验证请求同形状。
  await probeChat('L3 最小补全', {
    model: text.outboundModelId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  })

  // L4 maxTokens 上限：REQUEST_SHAPE.stepfun 声明 32768，逐级验证对端是否接受
  for (const maxTokens of [1024, 4096, 8192, 16384, 32768]) {
    await probeChat(`L4 max_tokens=${maxTokens}`, {
      model: text.outboundModelId,
      messages: [{ role: 'user', content: '回复一个字：好' }],
      max_tokens: maxTokens,
    })
  }

  // L5 视觉模型（Vision QA 路径）
  // 1x1 透明 PNG，最小可用图片输入。
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  await probeChat('L5 视觉模型', {
    model: vision.outboundModelId,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '这是什么颜色？' },
          { type: 'image_url', image_url: { url: TINY_PNG } },
        ],
      },
    ],
    max_tokens: 16,
  })

  // L6 结构化输出与工具调用：Director 的 pi 会话依赖这两项之一
  await probeChat('L6 response_format=json_object', {
    model: text.outboundModelId,
    messages: [{ role: 'user', content: '用 JSON 回复 {"ok":true}' }],
    max_tokens: 64,
    response_format: { type: 'json_object' },
  })
  await probeChat('L6 tools（函数调用）', {
    model: text.outboundModelId,
    messages: [{ role: 'user', content: '北京天气如何' }],
    max_tokens: 64,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '查询天气',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ],
  })

  // L7 长上下文：逼近 REQUEST_SHAPE.stepfun 声明的 131072
  for (const approxTokens of [8_000, 32_000, 100_000]) {
    await probeChat(`L7 上下文约 ${approxTokens} token`, {
      model: text.outboundModelId,
      // 中文约 1 字 ≈ 1 token，用重复字符逼近目标长度。
      messages: [{ role: 'user', content: `忽略以下内容并回复"好"：${'字'.repeat(approxTokens)}` }],
      max_tokens: 8,
    })
  }

  console.log('\n===== 归因汇总 =====')
  const failed = results.filter((item) => !item.ok)
  if (failed.length === 0) {
    console.log('全部通过：阶跃星辰侧的 Key、模型 ID、请求形状、上下文与视觉能力都可用。')
    console.log('若应用内仍失败，则问题在 pi-ai 的 openai-completions 适配层或上游编排，')
    console.log('不在阶跃星辰 API 本身——下一步应抓 Director 阶段的真实请求体。')
  } else {
    for (const item of failed) console.log(`- ${item.layer}: ${item.detail}`)
  }

  async function probeChat(layer: string, body: Record<string, unknown>): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        record(layer, false, await describeFailure(response))
        return
      }
      const parsed = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string
          message?: { content?: string; tool_calls?: unknown[] }
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const choice = parsed.choices?.[0]
      record(
        layer,
        true,
        `finish=${choice?.finish_reason ?? '-'} `
        + `toolCalls=${choice?.message?.tool_calls?.length ?? 0} `
        + `promptTokens=${parsed.usage?.prompt_tokens ?? '-'} `
        + `content=${JSON.stringify((choice?.message?.content ?? '').slice(0, 40))}`,
      )
    } catch (error) {
      record(layer, false, `${(error as Error).name}: ${(error as Error).message}`)
    }
  }
}

void main()
  .then(() => process.exit(results.some((item) => !item.ok) ? 1 : 0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[stepfun-probe] fatal: ${message}\n`)
    process.exit(1)
  })
