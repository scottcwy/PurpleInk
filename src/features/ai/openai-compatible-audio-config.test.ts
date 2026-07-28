import { describe, expect, it, vi } from 'vitest'
import {
  describeAsrProfile,
  saveAsrProfile,
  saveTtsProfile,
  validateAsrProfile,
  validateTtsProfile,
  type AudioProfileDependencies,
} from './openai-compatible-audio-config'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from './openai-compatible-payloads'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

const TTS_INPUT = {
  apiKey: 'tts-secret',
  baseUrl: 'https://example.test/v1/',
  model: 'tts-1',
  voice: 'alloy',
  audioFormat: 'mp3' as const,
}

const ASR_INPUT = {
  apiKey: 'asr-secret',
  baseUrl: 'https://example.test/v1',
  model: 'whisper-1',
}

describe('custom TTS endpoint validation', () => {
  it('runs a minimal real synthesis with the user voice and container', async () => {
    const inits: RequestInit[] = []
    const fetcher = capture(inits, () =>
      new Response(new Uint8Array([1, 2]), { status: 200 }),
    )

    await expect(validateTtsProfile(TTS_INPUT, fetcher)).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(String(inits[0]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'tts-1',
      voice: 'alloy',
      response_format: 'mp3',
    })
  })

  /** 返回 200 但零字节说明该端点其实没合成出音频，不能算通过。 */
  it('rejects an empty body even on HTTP 200', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(), { status: 200 }))
    await expect(validateTtsProfile(TTS_INPUT, fetcher)).resolves.toEqual({ ok: false })
  })

  it('reports the HTTP status when the endpoint rejects the request', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }))
    await expect(validateTtsProfile(TTS_INPUT, fetcher)).resolves.toEqual({
      ok: false,
      status: 401,
    })
  })

  it('refuses containers the local duration measurement cannot read', async () => {
    await expect(validateTtsProfile(
      { ...TTS_INPUT, audioFormat: 'opus' as unknown as 'mp3' },
      vi.fn(),
    )).rejects.toThrow('mp3 或 wav')
  })
})

describe('custom ASR endpoint validation', () => {
  it('negotiates verbose_json first and records segment timestamps', async () => {
    const inits: RequestInit[] = []
    const fetcher = capture(inits, () => new Response(
      JSON.stringify({ text: '', segments: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(validateAsrProfile(ASR_INPUT, fetcher)).resolves.toEqual({
      ok: true,
      timestampMode: 'segment',
      verification: 'transcription',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const body = inits[0]?.body as FormData
    expect(body.get('response_format')).toBe('verbose_json')
    expect(body.get('timestamp_granularities[]')).toBe('segment')
    // 样本是无语义合成音，空转写必须算通过。
  })

  /**
   * 部分转写模型只支持 json / text。降级重试一次并把结果落库，运行期不再探测。
   */
  it('falls back to plain json when verbose_json is unsupported', async () => {
    let call = 0
    const fetcher = vi.fn(async () => {
      call += 1
      return call === 1
        ? new Response('unsupported response_format', { status: 400 })
        : new Response(JSON.stringify({ text: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
    })

    await expect(validateAsrProfile(ASR_INPUT, fetcher)).resolves.toEqual({
      ok: true,
      timestampMode: 'none',
      verification: 'transcription',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  /** 401 不是格式问题，不该再多打一次请求。 */
  it('does not retry a credential failure as a format downgrade', async () => {
    const fetcher = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    await expect(validateAsrProfile(ASR_INPUT, fetcher)).resolves.toEqual({
      ok: false,
      reason: 'transcription-rejected',
      status: 401,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports transcription-rejected so the client can offer credential-only', async () => {
    const fetcher = vi.fn(async () => new Response('no speech detected', { status: 400 }))
    await expect(validateAsrProfile(ASR_INPUT, fetcher)).resolves.toMatchObject({
      ok: false,
      reason: 'transcription-rejected',
    })
  })

  it('still verifies credentials on the credential-only path', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ data: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(validateAsrProfile(
      { ...ASR_INPUT, credentialOnly: true },
      fetcher,
    )).resolves.toEqual({
      ok: true,
      timestampMode: 'none',
      verification: 'credential-only',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/v1/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('rejects credential-only when even /models fails', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 403 }))
    await expect(validateAsrProfile(
      { ...ASR_INPUT, credentialOnly: true },
      fetcher,
    )).resolves.toEqual({
      ok: false,
      reason: 'credential-rejected',
      status: 403,
    })
  })
})

describe('custom audio profile persistence', () => {
  it('stores the TTS key under its own provider identity', async () => {
    const test = harness()
    await saveTtsProfile(TTS_INPUT, test.dependencies)

    expect(test.credentials.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible-tts',
        secret: 'tts-secret',
      }),
    )
    expect(test.profileStore.saveTts).toHaveBeenCalledWith(
      expect.any(String),
      {
        baseUrl: 'https://example.test/v1',
        model: 'tts-1',
        voice: 'alloy',
        audioFormat: 'mp3',
      },
    )
  })

  /** timestampMode 只能来自协商结果，不接受用户输入。 */
  it('persists the negotiated timestamp capability for ASR', async () => {
    const test = harness()
    await saveAsrProfile(
      ASR_INPUT,
      { timestampMode: 'segment', verification: 'transcription' },
      test.dependencies,
    )

    expect(test.credentials.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-compatible-asr' }),
    )
    expect(test.profileStore.saveAsr).toHaveBeenCalledWith(expect.any(String), {
      baseUrl: 'https://example.test/v1',
      model: 'whisper-1',
      timestampMode: 'segment',
      verification: 'transcription',
    })
  })

  it('surfaces credential-only verification so the UI can say so', async () => {
    const test = harness()
    await saveAsrProfile(
      ASR_INPUT,
      { timestampMode: 'none', verification: 'credential-only' },
      test.dependencies,
    )

    await expect(describeAsrProfile(test.dependencies)).resolves.toMatchObject({
      configured: true,
      timestampMode: 'none',
      verification: 'credential-only',
    })
  })
})

/** 记录每次调用的 init，让断言可以检查请求体而不依赖 mock 元组的类型推导。 */
function capture(inits: RequestInit[], respond: () => Response) {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    if (init) inits.push(init)
    return Promise.resolve(respond())
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } }
}

function harness() {
  let tts: OpenAiCompatibleTtsProfile | null = null
  let asr: OpenAiCompatibleAsrProfile | null = null
  const credentials = {
    save: vi.fn(async () => {}),
    describe: vi.fn(async () => ({
      configured: true,
      verifiedAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    })),
  }
  const profileStore = {
    findTts: vi.fn(async () => tts),
    saveTts: vi.fn(async (_id: string, value: OpenAiCompatibleTtsProfile) => {
      tts = value
    }),
    findAsr: vi.fn(async () => asr),
    saveAsr: vi.fn(async (_id: string, value: OpenAiCompatibleAsrProfile) => {
      asr = value
    }),
  }
  return {
    dependencies: { credentials, profileStore } satisfies AudioProfileDependencies,
    credentials,
    profileStore,
  }
}
