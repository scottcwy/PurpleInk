import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  describeMimoConfig,
  getMimoConfig,
  saveMimoSettings,
} from './mimo-config'

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

function dependencies() {
  const models = new Map<string, {
    provider: string
    model: string
    revision: number
    workspaceId: string
    aiTaskKind: never
  }>()
  const media = new Map<string, {
    provider: string
    model: string
    revision: number
    workspaceId: string
    mediaTaskKind: never
  }>()
  const credentials: AiConfigDependencies['credentials'] = {
    save: vi.fn(async () => undefined),
    loadSecret: vi.fn(async () => 'stored-mimo-key'),
    describe: vi.fn(async () => ({
      configured: true,
      verifiedAt: null,
      updatedAt: null,
    })),
  }
  const modelRoutes = {
    find: vi.fn(async (_workspaceId: string, kind: string) =>
      models.get(kind) ?? null),
    resolve: vi.fn(),
    remove: vi.fn(async (_workspaceId: string, kind: string) =>
      models.delete(kind)),
    save: vi.fn(async (input: {
      workspaceId: string
      aiTaskKind: string
      provider: string
      model: string
    }) => {
      const route = { ...input, revision: 0 }
      models.set(input.aiTaskKind, route as never)
      return route
    }),
  } as unknown as AiConfigDependencies['modelRoutes']
  const mediaRoutes = {
    find: vi.fn(async (_workspaceId: string, kind: string) =>
      media.get(kind) ?? null),
    resolve: vi.fn(),
    remove: vi.fn(async (_workspaceId: string, kind: string) =>
      media.delete(kind)),
    save: vi.fn(async (input: {
      workspaceId: string
      mediaTaskKind: string
      provider: string
      model: string
    }) => {
      const route = { ...input, revision: 0 }
      media.set(input.mediaTaskKind, route as never)
      return route
    }),
  } as unknown as AiConfigDependencies['mediaRoutes']
  return {
    deps: { credentials, modelRoutes, mediaRoutes } as AiConfigDependencies,
    models,
    media,
  }
}

describe('MiMo configuration', () => {
  it('resolves product API defaults without an env secret fallback', async () => {
    const { deps } = dependencies()
    process.env.MIMO_BASE_URL = ''
    process.env.MIMO_API_KEY = 'must-not-be-read'

    await expect(getMimoConfig(deps)).resolves.toEqual({
      apiKey: 'stored-mimo-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      textModel: 'mimo-v2.5',
      visionModel: 'mimo-v2.5',
      ttsModel: 'mimo-v2.5-tts',
      asrModel: 'mimo-v2.5-asr',
    })
  })

  it('persists text, vision, TTS and ASR model routes under mimo', async () => {
    const { deps, models, media } = dependencies()
    await saveMimoSettings({
      textModel: 'mimo-v2.5',
      visionModel: 'mimo-v2.5',
      ttsModel: 'mimo-v2.5-tts-voicedesign',
      asrModel: 'mimo-v2.5-asr',
    }, deps)

    expect(models.get('fabricate')).toMatchObject({ provider: 'mimo' })
    expect(models.get('vision-qa')).toMatchObject({ provider: 'mimo' })
    expect(media.get('tts')).toMatchObject({
      provider: 'mimo',
      model: 'mimo-v2.5-tts-voicedesign',
    })
    expect(media.get('asr')).toMatchObject({ provider: 'mimo' })
    await expect(describeMimoConfig(deps)).resolves.toMatchObject({
      ttsModel: { source: 'settings' },
    })
  })
})
