import { describe, expect, it } from 'vitest'
import {
  workerAiRequestSchema,
  workerAiSuccessSchema,
} from './worker-gateway-contract'

const identity = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  attemptId: '00000000-0000-4000-8000-000000000002',
  operationId: 'website:job-1:capture:1',
  operationIndex: 1,
}

describe('worker AI gateway contract', () => {
  it('accepts bounded text, vision and TTS requests', () => {
    expect(workerAiRequestSchema.parse({
      ...identity,
      capability: 'vision',
      workload: 'website-capture',
      content: [
        { type: 'text', text: '判断下一步' },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      maxOutputTokens: 1_000,
    }).capability).toBe('vision')
    expect(workerAiRequestSchema.parse({
      ...identity,
      capability: 'tts',
      workload: 'website-tts',
      text: '旁白',
    }).capability).toBe('tts')
  })

  it('rejects provider, model, URL and credential injection fields', () => {
    expect(workerAiRequestSchema.safeParse({
      ...identity,
      capability: 'text',
      workload: 'website-compose',
      content: [{ type: 'text', text: 'compose' }],
      maxOutputTokens: 100,
      provider: 'openai',
      baseUrl: 'https://example.test',
      apiKey: 'forbidden',
    }).success).toBe(false)
  })

  it('returns only safe execution results', () => {
    expect(workerAiSuccessSchema.safeParse({
      ok: true,
      capability: 'tts',
      audioBase64: 'UklGRg==',
      audioFormat: 'wav',
      durationMs: 1_000,
      channelId: 'internal-channel',
    }).success).toBe(false)
  })
})
