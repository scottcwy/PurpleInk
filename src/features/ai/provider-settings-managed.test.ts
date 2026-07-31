import { describe, expect, it, vi } from 'vitest'
import { applyProviderSettings } from './provider-settings-apply'
import { validateProviderSettings } from './provider-settings-validation'
import { providerSettingsSchema } from './schemas'

vi.mock('server-only', () => ({}))

describe('managed provider settings boundary', () => {
  it('rejects built-in credentials before external validation or writes', async () => {
    const input = {
      providerServices: {
        gemini: { funding: 'managed' as const, apiKey: 'workspace-key' },
      },
    }

    await expect(validateProviderSettings(input)).resolves.toEqual({
      ok: false,
      rejection: {
        status: 422,
        body: {
          ok: false,
          valid: false,
          error: '平台托管模式不接受用户 API Key',
        },
      },
    })
    await expect(applyProviderSettings(input)).resolves.toMatchObject({
      ok: false,
      rejection: { status: 422 },
    })
  })

  it('removes legacy per-provider model mutation fields from the API schema', () => {
    expect(providerSettingsSchema.safeParse({
      mimo: { textModel: 'mimo-v2.5' },
    }).success).toBe(false)
  })
})
