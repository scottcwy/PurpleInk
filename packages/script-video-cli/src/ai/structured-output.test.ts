import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { AiClient, AiCompletionInput } from './openai-compatible'
import { AiProviderError } from './openai-compatible'
import { completeJsonWithRepair } from './structured-output'

const resultSchema = z.object({ ok: z.literal(true), title: z.string().min(1) }).strict()

describe('completeJsonWithRepair', () => {
  it('makes exactly one repair request after a schema failure', async () => {
    const calls: AiCompletionInput[] = []
    const ai: AiClient = {
      completeText: async () => 'unused',
      completeJson: async (input) => {
        calls.push(input)
        return calls.length === 1 ? { ok: false } : { ok: true, title: '已修复' }
      },
    }

    const result = await completeJsonWithRepair({
      ai,
      schema: resultSchema,
      stage: 'DIRECT',
      prompt: { system: '只返回 JSON', user: '生成结构化结果' },
    })

    expect(result).toEqual({ ok: true, title: '已修复' })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.system).toContain('JSON')
    expect(calls[1]?.user).toContain('DIRECT')
    expect(calls[1]?.user.length).toBeLessThan(5_000)
  })

  it('returns only AI_OUTPUT_INVALID when the single repair also fails', async () => {
    const privateMarker = 'private-provider-body-marker'
    let calls = 0
    const ai: AiClient = {
      completeText: async () => 'unused',
      completeJson: async () => {
        calls += 1
        return calls === 1 ? { privateMarker } : { ok: false, privateMarker }
      },
    }

    await expect(
      completeJsonWithRepair({
        ai,
        schema: resultSchema,
        stage: 'SHOT_SPEC:S001',
        prompt: { system: 'system', user: 'user' },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiProviderError &&
        error.code === 'AI_OUTPUT_INVALID' &&
        !error.message.includes(privateMarker) &&
        !JSON.stringify(error).includes(privateMarker),
    )
    expect(calls).toBe(2)
  })
})
