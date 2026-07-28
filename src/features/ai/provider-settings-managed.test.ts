import { describe, expect, it, vi } from 'vitest'
import { applyProviderSettings } from './provider-settings-apply'
import { validateProviderSettings } from './provider-settings-validation'

vi.mock('server-only', () => ({}))

describe('managed provider settings boundary', () => {
  it('rejects built-in credentials before external validation or writes', async () => {
    const input = { gemini: { apiKey: 'workspace-key' } }

    await expect(validateProviderSettings(input)).resolves.toEqual({
      ok: false,
      rejection: {
        status: 422,
        body: {
          ok: false,
          valid: false,
          error: '内置模型与旧凭据字段不接受写入，请使用服务来源配置',
        },
      },
    })
    await expect(applyProviderSettings(input)).resolves.toMatchObject({
      ok: false,
      rejection: { status: 422 },
    })
  })

  it('rejects even catalog model ids because managed routes own model selection', async () => {
    const input = { mimo: { textModel: 'mimo-v2.5' } }

    await expect(validateProviderSettings(input)).resolves.toMatchObject({
      ok: false,
      rejection: { status: 422 },
    })
    await expect(applyProviderSettings(input)).resolves.toMatchObject({
      ok: false,
      rejection: { status: 422 },
    })
  })
})
