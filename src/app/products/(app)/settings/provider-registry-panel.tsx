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
  PROVIDER_REGISTRY,
  type AiProviderId,
  type ProviderCapability,
} from '@/features/ai/provider-registry'
import { cn } from '@/lib/utils'
import { CustomOpenAiProviderPanel } from './custom-openai-provider-panel'
import {
  countConfiguredCustomEndpoints,
  CUSTOM_ENDPOINT_COUNT,
} from './custom-openai-status'
import {
  GEMINI_FIELDS,
  MIMO_FIELDS,
  STEPFUN_FIELDS,
  type ReadyModelSettingsController,
} from './model-service-contract'

/**
 * 供应商卡片是**家族**，不是 provider id。
 *
 * `openai-compatible` 家族在 registry 里是三个 id（文本视觉 / TTS / ASR），因为三份
 * 独立凭据必须有三个身份。但配置上它们同属「自定义兼容模型」这一个入口，所以网格
 * 只出四张卡片，三个接入点在卡片展开后的面板里按顺序配置。
 */
const PROVIDER_CARDS: readonly AiProviderId[] = [
  'gemini',
  'stepfun',
  'mimo',
  'openai-compatible',
]

/** 自定义家族的能力徽章是三个 id 的并集。 */
const CUSTOM_FAMILY: readonly AiProviderId[] = [
  'openai-compatible',
  'openai-compatible-tts',
  'openai-compatible-asr',
]

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
        summary={`${PROVIDER_CARDS.length} 个供应商`}
      >
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {PROVIDER_CARDS.map((provider) => {
            const definition = PROVIDER_REGISTRY[provider]
            const status = cardStatus(controller, provider)
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
                        {cardCapabilities(provider).map((capability) => (
                          <span
                            key={capability}
                            className="rounded bg-ds-surface-muted px-1.5 py-1 text-[10px] font-medium uppercase text-ds-text-muted"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    </div>
                    <StatusPill variant={status.variant} label={status.label} />
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
        onSaveKey={async (apiKey) =>
          (await controller.submit({ apiKey }, 'stepfun-key')).ok}
        onSaveFields={() => {
          void controller.submit(controller.stepfunDraft, 'stepfun-fields')
        }}
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
        onSaveKey={async (apiKey) => (await controller.submit(
          { gemini: { apiKey, ...controller.geminiDraft } },
          'gemini-key',
        )).ok}
        onSaveFields={() => {
          void controller.submit({ gemini: controller.geminiDraft }, 'gemini-fields')
        }}
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
      onSaveKey={async (apiKey) => (await controller.submit(
        { mimo: { apiKey, ...controller.mimoDraft } },
        'mimo-key',
      )).ok}
      onSaveFields={() => {
        void controller.submit({ mimo: controller.mimoDraft }, 'mimo-fields')
      }}
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

/** 家族能力徽章：自定义家族取三个 id 的并集，其余就是自身能力。 */
function cardCapabilities(provider: AiProviderId): ProviderCapability[] {
  if (provider !== 'openai-compatible') {
    return [...PROVIDER_REGISTRY[provider].capabilities]
  }
  const merged = new Set<ProviderCapability>()
  for (const id of CUSTOM_FAMILY) {
    for (const capability of PROVIDER_REGISTRY[id].capabilities) merged.add(capability)
  }
  return [...merged]
}

/**
 * 卡片状态。自定义家族有三个接入点，因此是三态——只显示「已连接 / 未连接」会在
 * 配了 1 个端点时谎报整个家族可用。
 */
function cardStatus(
  controller: ReadyModelSettingsController,
  provider: AiProviderId,
): { variant: 'rendered' | 'pending' | 'stale'; label: string } {
  if (provider === 'openai-compatible') {
    const configured = countConfiguredCustomEndpoints(controller.data)
    if (configured === 0) return { variant: 'pending', label: '未连接' }
    return configured === CUSTOM_ENDPOINT_COUNT
      ? { variant: 'rendered', label: '已连接' }
      : { variant: 'stale', label: `${configured} / ${CUSTOM_ENDPOINT_COUNT} 已配置` }
  }
  const configured = provider === 'stepfun'
    ? Boolean(controller.data.configured)
    : provider === 'gemini'
      ? Boolean(controller.data.geminiConfigured)
      : controller.data.mimoCredential?.configured === true
  return configured
    ? { variant: 'rendered', label: '已连接' }
    : { variant: 'pending', label: '未连接' }
}

function placeholderFor(field?: { value: string; source: string }): string {
  if (!field) return ''
  if (field.source === 'env') return `${field.value}（环境变量）`
  if (field.source === 'default') return `${field.value}（内置默认）`
  return field.value
}
