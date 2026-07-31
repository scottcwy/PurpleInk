import { describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from '@/features/ai/config'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'
import {
  CUSTOM_ASR_PROVIDER,
  CUSTOM_TTS_PROVIDER,
  describeMediaProvider,
  needsWholeClipAlignment,
  resolveNarrationEngine,
  synthesizeRoutedSpeech,
  transcribeRoutedSpeech,
} from './media-provider'
import type { ManagedAudioBillingInput } from './managed-audio-billing'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

type Provider = 'stepfun' | 'mimo' | 'openai-compatible-tts' | 'openai-compatible-asr'

const TTS_PROFILE: OpenAiCompatibleTtsProfile = {
  baseUrl: 'https://example.test/v1',
  model: 'tts-1',
  voice: 'verse',
  audioFormat: 'mp3',
}

const ASR_PROFILE: OpenAiCompatibleAsrProfile = {
  baseUrl: 'https://example.test/v1',
  model: 'whisper-1',
  timestampMode: 'segment',
  verification: 'transcription',
}

function builtInModel(provider: 'stepfun' | 'mimo', kind: 'tts' | 'asr') {
  if (provider === 'mimo') {
    return kind === 'tts' ? 'mimo-v2.5-tts' : 'mimo-v2.5-asr'
  }
  return kind === 'tts' ? 'stepaudio-2.5-tts' : 'stepaudio-2.5-asr'
}

function dependencies(
  provider: Provider,
  audio?: {
    tts?: OpenAiCompatibleTtsProfile | null
    asr?: OpenAiCompatibleAsrProfile | null
  },
) {
  const route = (kind: 'tts' | 'asr') => ({
    workspaceId: 'workspace',
    mediaTaskKind: kind,
    provider,
    // 自定义端点的路由行故意存一个过期模型名，用来证明解析以 profile 为准。
    model: provider === 'stepfun' || provider === 'mimo'
      ? builtInModel(provider, kind)
      : 'stale-route-model',
    revision: 1,
    secret: 'stored-key',
  })
  return {
    credentials: {
      loadSecret: vi.fn(async () => 'stored-key'),
    } as unknown as AiConfigDependencies['credentials'],
    modelRoutes: {} as AiConfigDependencies['modelRoutes'],
    mediaRoutes: {
      find: vi.fn(),
      remove: vi.fn(),
      save: vi.fn(),
      resolve: vi.fn(async (_workspaceId, kind) => route(kind)),
    },
    openAiCompatibleAudioProfiles: {
      // 用 in 判断而不是 ??：显式传 null 表示「未配置」，不能被默认 profile 吞掉。
      findTts: vi.fn(async () =>
        audio && 'tts' in audio ? audio.tts : TTS_PROFILE),
      saveTts: vi.fn(),
      findAsr: vi.fn(async () =>
        audio && 'asr' in audio ? audio.asr : ASR_PROFILE),
      saveAsr: vi.fn(),
    },
  } as unknown as AiConfigDependencies
}

function routedDependencies(provider: Provider, config = dependencies(provider)) {
  return {
    config,
    synthesizeStepfun: vi.fn(),
    synthesizeMimo: vi.fn(async () => ({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav' as const,
      durationMs: 0,
      model: 'mimo-v2.5-tts',
      nativeCaptions: [],
    })),
    transcribeStepfun: vi.fn(),
    transcribeMimo: vi.fn(async () => ({
      transcript: '转写',
      model: 'mimo-v2.5-asr',
      captions: [],
    })),
    synthesizeCustom: vi.fn(async () => ({
      audioBytes: Buffer.from('mp3'),
      audioFormat: 'mp3' as const,
      durationMs: 0,
      model: 'tts-1',
      nativeCaptions: [],
    })),
    transcribeCustom: vi.fn(async () => ({
      transcript: '自定义转写',
      model: 'whisper-1',
      captions: [{ text: '自定义转写', startMs: 0, endMs: 900 }],
      timestampMode: 'segment' as const,
    })),
    billManaged: bypassManagedBilling,
  }
}

async function bypassManagedBilling<T>(
  input: ManagedAudioBillingInput<T>,
): Promise<T> {
  return input.invoke()
}

describe('media provider dispatcher', () => {
  it('uses MiMo defaults for narration format and voice', async () => {
    await expect(resolveNarrationEngine(dependencies('mimo')))
      .resolves.toEqual({
        provider: 'mimo',
        model: 'mimo-v2.5-tts',
        voice: 'mimo_default',
        audioFormat: 'wav',
      })
  })

  it('dispatches synthesis and transcription to the configured provider', async () => {
    const deps = routedDependencies('mimo')

    await synthesizeRoutedSpeech({ text: '旁白' }, deps)
    await transcribeRoutedSpeech({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav',
      audioSeconds: 1,
    }, deps)

    expect(deps.synthesizeMimo).toHaveBeenCalledOnce()
    expect(deps.transcribeMimo).toHaveBeenCalledOnce()
    expect(deps.synthesizeStepfun).not.toHaveBeenCalled()
    expect(deps.synthesizeCustom).not.toHaveBeenCalled()
  })

  it('forwards the project cancellation signal to the routed ASR adapter', async () => {
    const deps = routedDependencies('mimo')
    const controller = new AbortController()

    await transcribeRoutedSpeech({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav',
      audioSeconds: 1,
      signal: controller.signal,
    }, deps)

    expect(deps.transcribeMimo).toHaveBeenCalledWith(
      {
        audioBytes: Buffer.from('wav'),
        audioFormat: 'wav',
      },
      undefined,
      { signal: controller.signal },
    )
  })

  it('keeps provider adapters untouched when the managed quota gate rejects', async () => {
    const deps = {
      ...routedDependencies('mimo'),
      billManaged: async <T>(_input: ManagedAudioBillingInput<T>): Promise<T> => {
        throw new Error('quota_exhausted')
      },
    }

    await expect(synthesizeRoutedSpeech({ text: '旁白' }, deps))
      .rejects.toThrow('quota_exhausted')

    expect(deps.synthesizeMimo).not.toHaveBeenCalled()
    expect(deps.synthesizeStepfun).not.toHaveBeenCalled()
  })

  it('takes voice, container and model from the custom TTS profile', async () => {
    await expect(resolveNarrationEngine(dependencies(CUSTOM_TTS_PROVIDER)))
      .resolves.toEqual({
        provider: CUSTOM_TTS_PROVIDER,
        model: 'tts-1',
        voice: 'verse',
        audioFormat: 'mp3',
      })
  })

  /**
   * 自定义端点的模型真值在 profile。若这里改读 `route.model`，用户在端点里改了模型
   * 但没重存路由时，`narration.ts` 的 assertEngine 会以「TTS 模型与配置不一致」失败，
   * 而设置页仍显示旧模型。
   */
  it('prefers the profile model over a stale route row', async () => {
    await expect(describeMediaProvider('tts', dependencies(CUSTOM_TTS_PROVIDER)))
      .resolves.toEqual({ provider: CUSTOM_TTS_PROVIDER, model: 'tts-1' })
    await expect(describeMediaProvider('asr', dependencies(CUSTOM_ASR_PROVIDER)))
      .resolves.toEqual({ provider: CUSTOM_ASR_PROVIDER, model: 'whisper-1' })
  })

  it('routes custom audio calls to the OpenAI-compatible client', async () => {
    let billingCalls = 0
    const billManaged = async <T>(
      _input: ManagedAudioBillingInput<T>,
    ): Promise<T> => {
      billingCalls += 1
      return _input.invoke()
    }
    const ttsDeps = {
      ...routedDependencies(CUSTOM_TTS_PROVIDER),
      billManaged,
    }
    await synthesizeRoutedSpeech({ text: '旁白' }, ttsDeps)
    expect(ttsDeps.synthesizeCustom).toHaveBeenCalledOnce()
    expect(ttsDeps.synthesizeMimo).not.toHaveBeenCalled()

    const asrDeps = {
      ...routedDependencies(CUSTOM_ASR_PROVIDER),
      billManaged,
    }
    const result = await transcribeRoutedSpeech({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav',
    }, asrDeps)
    expect(asrDeps.transcribeCustom).toHaveBeenCalledOnce()
    expect(result.alignmentSource).toBe('openai-compatible-asr-segment')
    expect(billingCalls).toBe(2)
  })

  it('marks whole-clip alignment when the endpoint returns no timestamps', async () => {
    const deps = {
      ...routedDependencies(CUSTOM_ASR_PROVIDER),
      transcribeCustom: vi.fn(async () => ({
        transcript: '整段',
        model: 'gpt-4o-transcribe',
        captions: [] as { text: string; startMs: number; endMs: number }[],
        timestampMode: 'none' as 'segment' | 'none',
      })),
    }

    const result = await transcribeRoutedSpeech({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav',
    }, deps)

    expect(result.alignmentSource).toBe('openai-compatible-asr-whole')
    expect(needsWholeClipAlignment(result.alignmentSource)).toBe(true)
  })

  it('rejects containers the custom ASR endpoint cannot accept', async () => {
    await expect(transcribeRoutedSpeech({
      audioBytes: Buffer.from('ogg'),
      audioFormat: 'ogg',
    }, routedDependencies(CUSTOM_ASR_PROVIDER))).rejects.toThrow('MP3 或 WAV')
  })

  it('fails explicitly when the custom endpoint has no profile', async () => {
    await expect(resolveNarrationEngine(
      dependencies(CUSTOM_TTS_PROVIDER, { tts: null }),
    )).rejects.toThrow('自定义兼容 TTS 端点尚未配置')
  })

  it('still rejects an unknown media provider', async () => {
    const config = dependencies('mimo')
    config.mediaRoutes.resolve = vi.fn(async () => ({
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      revision: 1,
      secret: null,
    })) as unknown as AiConfigDependencies['mediaRoutes']['resolve']

    await expect(describeMediaProvider('tts', config))
      .rejects.toThrow('媒体路由供应商不受支持')
  })

  it('keeps stepfun alignment out of the whole-clip fallback', () => {
    expect(needsWholeClipAlignment('stepfun-asr')).toBe(false)
    expect(needsWholeClipAlignment('openai-compatible-asr-segment')).toBe(false)
    expect(needsWholeClipAlignment('mimo-asr-segment')).toBe(true)
  })
})
