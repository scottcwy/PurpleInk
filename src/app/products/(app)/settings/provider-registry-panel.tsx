'use client'

import { Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
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
import type { ReadyModelSettingsController } from './model-service-contract'

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
  openPanels,
  onPanelOpenChange,
}: {
  controller: ReadyModelSettingsController
  openPanels: Record<string, boolean>
  onPanelOpenChange: (id: string, open: boolean) => void
}) {
  const [selected, setSelected] = useState<AiProviderId>('mimo')
  const detailRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  return (
    <SettingsPanel
      id="providers"
      title="模型供应商"
      description="内置模型由平台托管；自定义 OpenAI-compatible 继续使用自己的凭据"
      icon={Network}
      summary={`${PROVIDER_CARDS.length} 个供应商`}
      open={openPanels['providers'] ?? false}
      onOpenChange={(open) => onPanelOpenChange('providers', open)}
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
      <div ref={detailRef}>
        <SelectedProvider controller={controller} provider={selected} />
      </div>
    </SettingsPanel>
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
      <ManagedProviderDetail
        provider="StepFun"
        providerId="stepfun"
        controller={controller}
      />
    )
  }
  if (provider === 'gemini') {
    return (
      <ManagedProviderDetail
        provider="Gemini"
        providerId="gemini"
        controller={controller}
      />
    )
  }
  return (
    <ManagedProviderDetail
      provider="MiMo"
      providerId="mimo"
      controller={controller}
    />
  )
}

interface ManagedProviderDetailProps {
  provider: 'StepFun' | 'Gemini' | 'MiMo'
  providerId: 'stepfun' | 'gemini' | 'mimo'
  controller: ReadyModelSettingsController
}

function ManagedProviderDetail(props: ManagedProviderDetailProps) {
  const view = props.controller.data.managedProviders?.find(
    ({ provider }) => provider === props.providerId,
  )
  const locked =
    props.providerId === 'gemini' && props.controller.data.planKey === 'free'
  const models = view?.models ?? []
  return (
    <div id={`provider-${props.provider.toLowerCase()}`} className="flex min-w-0 flex-col">
      <SettingsSeparator />
      <SettingsRow
        label={`${props.provider} 连接与模型`}
        chevron={false}
        className="h-auto min-h-11 flex-col items-stretch gap-1 py-3 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="text-xs text-ds-text-muted">
            {locked
              ? 'Free 方案不可使用 Gemini；升级 Plus 后解锁'
              : '平台统一提供服务，不需要填写 API Key'}
          </span>
          <StatusPill
            variant={locked ? 'stale' : view?.configured ? 'rendered' : 'pending'}
            label={locked ? 'Plus 解锁' : view?.configured ? '平台服务可用' : '平台服务未配置'}
          />
        </div>
      </SettingsRow>
      <SettingsSeparator />
      <SettingsRow
        label="可用模型"
        chevron={false}
      >
        <span className="text-xs text-ds-text-muted">
          {locked ? '当前方案未授权该供应商' : '模型目录由服务端统一维护'}
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {models.length > 0 ? models.map((model) => (
            <StatusPill
              key={`${model.modelId}:${model.capabilities.join(',')}`}
              variant="cached"
              label={`${model.modelId} · ${model.capabilities.join('/')}`}
            />
          )) : (
            <span className="text-xs text-ds-text-muted">
              {locked ? '升级 Plus 解锁' : '暂无可用模型'}
            </span>
          )}
        </div>
      </SettingsRow>
    </div>
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
  const managed = controller.data.managedProviders?.find(
    (entry) => entry.provider === provider,
  )
  if (provider === 'gemini' && controller.data.planKey === 'free') {
    return { variant: 'stale', label: 'Plus 解锁' }
  }
  const configured = managed?.configured === true
  return configured
    ? { variant: 'rendered', label: '已连接' }
    : { variant: 'pending', label: '未连接' }
}
