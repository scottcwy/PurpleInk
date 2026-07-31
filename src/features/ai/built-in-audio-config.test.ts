import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  funding: vi.fn(),
  apiKey: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./config', () => ({
  getAiConfigDependencies: vi.fn(),
  resolveProviderFunding: mocks.funding,
  resolveProviderApiKey: mocks.apiKey,
}))

import { resolveBuiltInAudioConfig } from './built-in-audio-config'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.apiKey.mockResolvedValue('credential')
})

describe('built-in audio config', () => {
  it('resolves managed StepFun audio only from the generated deployment catalog', async () => {
    mocks.funding.mockResolvedValue('managed')

    await expect(resolveBuiltInAudioConfig('stepfun')).resolves.toEqual({
      apiKey: 'credential',
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      ttsModel: 'stepaudio-2.5-tts',
      asrModel: 'stepaudio-2.5-asr',
    })
  })

  it('resolves MiMo BYOK to the fixed official channel', async () => {
    mocks.funding.mockResolvedValue('byok')

    await expect(resolveBuiltInAudioConfig('mimo')).resolves.toEqual({
      apiKey: 'credential',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      ttsModel: 'mimo-v2.5-tts',
      asrModel: 'mimo-v2.5-asr',
    })
  })
})
