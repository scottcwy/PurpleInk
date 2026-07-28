'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsField } from '@/components/ui/settings-field'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import type { ManagedProviderId } from '@/features/ai'
import type { ReadyModelSettingsController } from './model-service-contract'
import { useSaveFeedback } from './save-feedback'

const SOURCE_OPTIONS = [
  { value: 'managed', label: 'PurpleInk 服务' },
  { value: 'byok', label: '自己的 API Key' },
] as const

export function BuiltInProviderService({
  provider,
  label,
  controller,
}: {
  provider: ManagedProviderId
  label: string
  controller: ReadyModelSettingsController
}) {
  const view = controller.data.managedProviders?.find(
    (entry) => entry.provider === provider,
  )
  const [funding, setFunding] = useState<'managed' | 'byok'>(
    view?.funding ?? 'managed',
  )
  const [apiKey, setApiKey] = useState('')
  const { state, report } = useSaveFeedback()
  const managedLocked = provider === 'gemini'
    && controller.data.planKey === 'free'
  const activeConfigured = funding === 'managed'
    ? view?.managedConfigured === true && !managedLocked
    : view?.byokCredential.configured === true

  async function save() {
    const service = {
      funding,
      ...(funding === 'byok' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    }
    const result = await controller.submit(
      { providerServices: { [provider]: service } },
      `service-${provider}`,
    )
    if (result.ok) setApiKey('')
    report(result.ok)
  }

  return (
    <div className="flex min-w-0 flex-col">
      <SettingsSeparator />
      <SettingsField
        label={`${label} 服务来源`}
        hint="两种来源不会自动互相回退；自有 Key 不消耗 PurpleInk 会员额度"
      >
        <SegmentedControl
          options={[...SOURCE_OPTIONS]}
          value={funding}
          onChange={(value) => setFunding(value === 'byok' ? 'byok' : 'managed')}
        />
      </SettingsField>
      <SettingsSeparator />
      <SettingsField
        label="连接状态"
        hint={
          funding === 'managed'
            ? managedLocked
              ? 'Free 方案不可使用 Gemini 托管服务；可以改用自己的 Gemini Key'
              : '使用平台凭据，调用计入当前会员额度'
            : '密钥加密保存，仅服务端在当前 workspace 的调用中解密'
        }
      >
        <StatusPill
          variant={activeConfigured ? 'rendered' : managedLocked ? 'stale' : 'pending'}
          label={
            activeConfigured
              ? funding === 'managed' ? '平台服务可用' : '自有 Key 已配置'
              : managedLocked ? 'Plus 解锁' : '未配置'
          }
        />
      </SettingsField>
      {funding === 'byok' && (
        <>
          <SettingsSeparator />
          <SettingsField label="API Key" hint="留空表示继续使用已验证的 Key">
            <TextField
              aria-label={`${label} API Key`}
              type="password"
              variant="ghost"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                view?.byokCredential.configured
                  ? '输入新 Key 以更新并验证'
                  : '输入 API Key'
              }
              className="min-w-[220px] flex-1"
            />
          </SettingsField>
        </>
      )}
      <SettingsSeparator />
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5">
        <span className="mr-auto text-xs text-ds-text-muted">
          {funding === 'managed'
            ? '平台服务按会员等级与额度计费'
            : '保存新 Key 时会发起一次 1 Token 验证'}
        </span>
        {state === 'success' && <StatusPill variant="rendered" label="已保存" />}
        {state === 'error' && <StatusPill variant="failed" label="保存失败" />}
        <Button
          size="sm"
          variant="tinted"
          disabled={
            controller.busy === `service-${provider}`
            || (funding === 'managed' && managedLocked)
            || (
              funding === 'byok'
              && !apiKey.trim()
              && !view?.byokCredential.configured
            )
          }
          onClick={() => void save()}
        >
          {controller.busy === `service-${provider}` ? '验证中…' : '保存服务来源'}
        </Button>
      </div>
    </div>
  )
}
