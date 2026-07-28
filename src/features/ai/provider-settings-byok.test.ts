import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  describeCredential: vi.fn(),
  saveCredential: vi.fn(),
  saveFunding: vi.fn(),
  validateStepfun: vi.fn(),
  validateGemini: vi.fn(),
  validateMimo: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/workspace-context', () => ({
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
}))
vi.mock('./config', () => ({
  getAiConfigDependencies: () => ({
    credentials: {
      describe: mocks.describeCredential,
      save: mocks.saveCredential,
    },
    providerFunding: { save: mocks.saveFunding },
    currentPlan: vi.fn(async () => 'free'),
  }),
}))
vi.mock('./stepfun-adapter', () => ({
  validateKey: mocks.validateStepfun,
}))
vi.mock('./gemini-adapter', () => ({
  validateGeminiKey: mocks.validateGemini,
}))
vi.mock('./mimo-adapter', () => ({
  validateMimoKey: mocks.validateMimo,
}))

import { applyProviderSettings } from './provider-settings-apply'
import { validateProviderSettings } from './provider-settings-validation'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.describeCredential.mockResolvedValue({ configured: false })
  mocks.validateStepfun.mockResolvedValue(true)
  mocks.validateGemini.mockResolvedValue(true)
  mocks.validateMimo.mockResolvedValue({ ok: true })
})

describe('built-in provider funding settings', () => {
  it('validates then saves a Gemini BYOK key without requiring a paid plan', async () => {
    const input = {
      providerServices: {
        gemini: { funding: 'byok' as const, apiKey: 'user-gemini-key' },
      },
    }

    await expect(validateProviderSettings(input)).resolves.toMatchObject({ ok: true })
    expect(mocks.validateGemini).toHaveBeenCalledWith('user-gemini-key')
    expect(mocks.saveCredential).not.toHaveBeenCalled()

    await expect(applyProviderSettings(input)).resolves.toMatchObject({ ok: true })
    expect(mocks.saveCredential).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      secret: 'user-gemini-key',
    }))
    expect(mocks.saveFunding).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'gemini',
      'byok',
    )
  })

  it('does not accept BYOK mode without a new or existing key', async () => {
    await expect(validateProviderSettings({
      providerServices: { stepfun: { funding: 'byok' } },
    })).resolves.toMatchObject({
      ok: false,
      rejection: { status: 422 },
    })
  })

  it('switches back to managed without validating, overwriting, or deleting BYOK', async () => {
    const input = {
      providerServices: { mimo: { funding: 'managed' as const } },
    }

    await expect(validateProviderSettings(input)).resolves.toMatchObject({ ok: true })
    await expect(applyProviderSettings(input)).resolves.toMatchObject({ ok: true })
    expect(mocks.validateMimo).not.toHaveBeenCalled()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
    expect(mocks.saveFunding).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'mimo',
      'managed',
    )
  })
})
