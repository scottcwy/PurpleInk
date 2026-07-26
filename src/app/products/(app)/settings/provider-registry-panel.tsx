'use client'

import { Bot, KeyRound, Network } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import {
  AI_PROVIDER_IDS,
  PROVIDER_REGISTRY,
  type AiProviderId,
} from '@/features/ai/provider-registry'
import { cn } from '@/lib/utils'
import { CustomOpenAiProviderPanel } from './custom-openai-provider-panel'
import {
  GEMINI_FIELDS,
  MIMO_FIELDS,
  STEPFUN_FIELDS,
  type ReadyModelSettingsController,
} from './model-service-contract'

export function ProviderRegistryPanel({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  const [selected, setSelected] = useState<AiProviderId>('mimo')
  return (
    <div id="providers" className="flex min-w-0 scroll-mt-5 flex-col gap-3">
      <SettingsPanel
        title="模型供应商"
        description="先连接服务，再按能力分配工作流；密钥仅在校验成功后替换"
        icon={Network}
        summary="4 个供应商"
      >
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {AI_PROVIDER_IDS.map((provider) => {
            const definition = PROVIDER_REGISTRY[provider]
            const configured = isConfigured(controller, provider)
            return (
              <button
                key={provider}
                type="button"
                aria-pressed={selected === provider}
                onClick={() => setSelected(provider)}
                className="text-left"
              >
                <Card
                  className={cn(
                    'h-full transition-colors',
                    selected === provider
                      ? 'border-ds-blue bg-ds-blue-soft'
                      : 'hover:border-ds-border-strong'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{definition.label}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {definition.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="rounded bg-ds-surface-muted px-1.5 py-1 text-[10px] font-medium uppercase text-ds-text-muted"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    </div>
                    <StatusPill
                      variant={configured ? 'rendered' : 'pending'}
                      label={configured ? '已连接' : '未连接'}
                    />
                  </div>
                </Card>
              </button>
            )
          })}
        </div>
      </SettingsPanel>
      <SelectedProvider controller={controller} provider={selected} />
    </div>
  )
}

function SelectedProvider({
  controller,
  provider,
}: {
  controller: ReadyModelSettingsController
  provider: AiProviderId
}) {
  if (provider === 'openai-compatible') {
    return <CustomOpenAiProviderPanel controller={controller} />
  }
  if (provider === 'stepfun') {
    return (
      <ProviderDetail
        provider="StepFun"
        configured={Boolean(controller.data.configured)}
        fields={STEPFUN_FIELDS}
        draft={controller.stepfunDraft}
        view={controller.data.models}
        busy={controller.busy}
        onDraft={controller.setStepfunField}
        onSaveKey={(apiKey) => controller.submit({ apiKey }, 'stepfun-key')}
        onSaveFields={() => controller.submit(controller.stepfunDraft, 'stepfun-fields')}
      />
    )
  }
  if (provider === 'gemini') {
    return (
      <ProviderDetail
        provider="Gemini"
        configured={Boolean(controller.data.geminiConfigured)}
        fields={GEMINI_FIELDS}
        draft={controller.geminiDraft}
        view={controller.data.gemini}
        busy={controller.busy}
        onDraft={controller.setGeminiField}
        onSaveKey={(apiKey) =>
          controller.submit({ gemini: { apiKey, ...controller.geminiDraft } }, 'gemini-key')
        }
        onSaveFields={() =>
          controller.submit({ gemini: controller.geminiDraft }, 'gemini-fields')
        }
      />
    )
  }
  return (
    <ProviderDetail
      provider="MiMo"
      configured={controller.data.mimoCredential?.configured === true}
      fields={MIMO_FIELDS}
      draft={controller.mimoDraft}
      view={controller.data.mimo}
      busy={controller.busy}
      onDraft={controller.setMimoField}
      onSaveKey={(apiKey) =>
        controller.submit({ mimo: { apiKey, ...controller.mimoDraft } }, 'mimo-key')
      }
      onSaveFields={() =>
        controller.submit({ mimo: controller.mimoDraft }, 'mimo-fields')
      }
    />
  )
}

interface ProviderDetailProps<T extends string> {
  provider: 'StepFun' | 'Gemini' | 'MiMo'
  configured: boolean
  fields: Array<[T, string]>
  draft: Record<T, string>
  view?: Record<T, { value: string; source: string }>
  busy?: string
  onDraft: (field: T, value: string) => void
  onSaveKey: (apiKey: string) => Promise<boolean>
  onSaveFields: () => void
}

function ProviderDetail<T extends string>(props: ProviderDetailProps<T>) {
  const [apiKey, setApiKey] = useState('')
  const keyBusy = props.busy === `${props.provider.toLowerCase()}-key`
  async function saveKey() {
    if (await props.onSaveKey(apiKey)) setApiKey('')
  }
  return (
    <SettingsPanel
      id={`provider-${props.provider.toLowerCase()}`}
      title={`${props.provider} 连接与模型`}
      description={
        props.provider === 'MiMo'
          ? '业务后端使用 sk- 产品 API Key；tp- Token Plan Key 不可用于此处'
          : '密钥与模型配置分开保存，便于先验证连接再微调模型'
      }
      icon={props.provider === 'Gemini' ? Bot : KeyRound}
      summary={props.configured ? '已连接' : '未连接'}
    >
      <SettingsRow label="API Key" className="h-auto flex-col items-stretch gap-2 py-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
          <TextField
            aria-label={`${props.provider} API Key`}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={props.configured ? '输入新 Key 以重新校验' : '输入 API Key'}
            className="min-w-[200px] flex-1"
          />
          <Button
            size="sm"
            variant="gray"
            disabled={!apiKey.trim() || keyBusy}
            onClick={() => void saveKey()}
          >
            校验并保存
          </Button>
        </div>
      </SettingsRow>
      {props.fields.map(([field, label]) => (
        <div key={field}>
          <SettingsSeparator />
          <SettingsRow label={label}>
            <TextField
              aria-label={`${props.provider} ${label}`}
              value={props.draft[field]}
              onChange={(event) => props.onDraft(field, event.target.value)}
              placeholder={placeholderFor(props.view?.[field])}
              className="w-full max-w-[320px]"
            />
          </SettingsRow>
        </div>
      ))}
      <SettingsSeparator />
      <SettingsRow label="模型配置">
        <span className="text-xs text-ds-text-muted">留空时使用环境变量或内置默认</span>
        <Button
          size="sm"
          variant="gray"
          disabled={Boolean(props.busy)}
          onClick={props.onSaveFields}
        >
          保存模型
        </Button>
      </SettingsRow>
    </SettingsPanel>
  )
}

function isConfigured(
  controller: ReadyModelSettingsController,
  provider: AiProviderId
): boolean {
  if (provider === 'stepfun') return Boolean(controller.data.configured)
  if (provider === 'gemini') return Boolean(controller.data.geminiConfigured)
  if (provider === 'mimo') return controller.data.mimoCredential?.configured === true
  return controller.data.customOpenAi?.configured === true
}

function placeholderFor(field?: { value: string; source: string }): string {
  if (!field) return ''
  if (field.source === 'env') return `${field.value}（环境变量）`
  if (field.source === 'default') return `${field.value}（内置默认）`
  return field.value
}
