'use client'

import { Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { SettingsField } from '@/components/ui/settings-field'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { StatusPill } from '@/components/ui/status-pill'
import {
  PROVIDER_REGISTRY,
  type AiProviderId,
  type ProviderCapability,
} from '@/features/ai/provider-registry'
import type { BuiltInProviderId as ManagedProviderId } from '@/lib/config/generated/ai-public-catalog'
import { cn } from '@/lib/utils'
import { CustomOpenAiProviderPanel } from './custom-openai-provider-panel'
import {
  countConfiguredCustomEndpoints,
  CUSTOM_ENDPOINT_COUNT,
} from './custom-openai-status'
import type { ReadyModelSettingsController } from './model-service-contract'
import { BuiltInProviderService } from './built-in-provider-service'

/**
 * 供应商卡片是**家族**，不是 provider id。
 *
 * `openai-compatible` 家族在 registry 里是三个 id（文本视觉 / TTS / ASR），因为三份
 * 独立凭据必须有三个身份。但配置上它们同属「自定义兼容模型」这一个入口，所以网格
 * 只出一个家族卡片，三个接入点在卡片展开后的面板里按顺序配置。
 */
type ProviderCardId = ManagedProviderId | 'openai-compatible'

const PROVIDER_CARDS: readonly ProviderCardId[] = [
  'gemini',
  'stepfun',
  'mimo',
  'openai',
  'anthropic',
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
  const [selected, setSelected] = useState<ProviderCardId>('mimo')
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
      description="内置模型可选择 PurpleInk 会员服务或自己的 API Key"
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
                  'h-full transition-colors duration-fast ease-standard',
                  selected === provider
                    ? 'border-ds-blue bg-ds-blue-soft'
                    : 'hover:border-ds-blue/50'
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
  provider: ProviderCardId
}) {
  if (provider === 'openai-compatible') {
    return <CustomOpenAiProviderPanel controller={controller} />
  }
  return (
    <ManagedProviderDetail
      provider={PROVIDER_REGISTRY[provider].label}
      providerId={provider}
      controller={controller}
    />
  )
}

interface ManagedProviderDetailProps {
  provider: string
  providerId: ManagedProviderId
  controller: ReadyModelSettingsController
}

function ManagedProviderDetail(props: ManagedProviderDetailProps) {
  const view = props.controller.data.managedProviders?.find(
    ({ provider }) => provider === props.providerId,
  )
  const locked = view?.managedAllowed === false
    && view.funding !== 'byok'
  const minimumPlan = planLabel(view?.minimumManagedPlan)
  const models = view?.models ?? []
  return (
    <div id={`provider-${props.provider.toLowerCase()}`} className="flex min-w-0 flex-col">
      <BuiltInProviderService
        provider={props.providerId}
        label={props.provider}
        controller={props.controller}
      />
      <SettingsSeparator />
      <SettingsField
        label="可用模型"
        hint={
          locked && view?.funding !== 'byok'
            ? `托管模式需要 ${minimumPlan} 方案；自己的 Key 不受此限制`
            : '模型目录由服务端统一维护'
        }
      >
        <div className="flex flex-wrap justify-end gap-1.5">
          {models.length > 0 ? models.map((model) => (
            <StatusPill
              key={`${model.modelId}:${model.capabilities.join(',')}`}
              variant="cached"
              label={`${model.modelId} · ${model.capabilities.map((capability) =>
                `${capability} ${
                  model.verifiedCapabilities.includes(capability)
                    ? '已验证'
                    : '待验证'
                }`).join(' / ')}`}
            />
          )) : (
            <span className="text-xs text-ds-text-muted">
              {locked && view?.funding !== 'byok'
                ? `升级 ${minimumPlan} 或使用自己的 Key`
                : '暂无可用模型'}
            </span>
          )}
        </div>
      </SettingsField>
    </div>
  )
}

/** 家族能力徽章：自定义家族取三个 id 的并集，其余就是自身能力。 */
function cardCapabilities(provider: ProviderCardId): ProviderCapability[] {
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
  provider: ProviderCardId,
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
  if (managed?.managedAllowed === false && managed.funding !== 'byok') {
    return {
      variant: 'stale',
      label: `${planLabel(managed.minimumManagedPlan)} 解锁`,
    }
  }
  const configured = managed?.configured === true
  return configured
    ? { variant: 'rendered', label: '已连接' }
    : { variant: 'pending', label: '未连接' }
}

function planLabel(plan: 'free' | 'plus' | 'pro' | 'max' | undefined): string {
  if (plan === 'plus') return 'Plus'
  if (plan === 'pro') return 'Pro'
  if (plan === 'max') return 'Max'
  return 'Free'
}
