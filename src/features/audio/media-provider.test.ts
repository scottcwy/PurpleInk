import { describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from '@/features/ai/config'
import {
  resolveNarrationEngine,
  synthesizeRoutedSpeech,
  transcribeRoutedSpeech,
} from './media-provider'

vi.mock('server-only', () => ({}))

function dependencies(provider: 'stepfun' | 'mimo') {
  const route = (kind: 'tts' | 'asr') => ({
    workspaceId: 'workspace',
    mediaTaskKind: kind,
    provider,
    model: provider === 'mimo'
      ? kind === 'tts' ? 'mimo-v2.5-tts' : 'mimo-v2.5-asr'
      : kind === 'tts' ? 'stepaudio-2.5-tts' : 'stepaudio-2.5-asr',
    revision: 1,
    secret: 'stored-key',
  })
  return {
    credentials: {} as AiConfigDependencies['credentials'],
    modelRoutes: {} as AiConfigDependencies['modelRoutes'],
    mediaRoutes: {
      find: vi.fn(),
      remove: vi.fn(),
      save: vi.fn(),
      resolve: vi.fn(async (_workspaceId, kind) => route(kind)),
    },
  } as AiConfigDependencies
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
    const synthesizeMimo = vi.fn(async () => ({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav' as const,
      durationMs: 0,
      model: 'mimo-v2.5-tts',
      nativeCaptions: [],
    }))
    const transcribeMimo = vi.fn(async () => ({
      transcript: '转写',
      model: 'mimo-v2.5-asr',
      captions: [],
    }))
    const deps = {
      config: dependencies('mimo'),
      synthesizeStepfun: vi.fn(),
      synthesizeMimo,
      transcribeStepfun: vi.fn(),
      transcribeMimo,
    }

    await synthesizeRoutedSpeech({ text: '旁白' }, deps)
    await transcribeRoutedSpeech({
      audioBytes: Buffer.from('wav'),
      audioFormat: 'wav',
    }, deps)

    expect(synthesizeMimo).toHaveBeenCalledOnce()
    expect(transcribeMimo).toHaveBeenCalledOnce()
    expect(deps.synthesizeStepfun).not.toHaveBeenCalled()
  })
})
