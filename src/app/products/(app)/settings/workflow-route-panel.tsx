'use client'

import { Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsField } from '@/components/ui/settings-field'
import type { AiProviderId, DirectorRouteView } from '@/features/ai/model-routing'
import {
  PROVIDER_REGISTRY,
  providersFor,
  type ProviderCapability,
} from '@/features/ai/provider-registry'
import type { DirectorCanvasNodeType } from '@/features/canvas/types'
import {
  ROUTE_ROWS,
  type RouteDraft,
  type SettingsResponse,
} from './model-service-contract'

export function WorkflowRoutePanel({
  routes,
  effective,
  managedProviders,
  busy,
  onChange,
  onSave,
  openPanels,
  onPanelOpenChange,
}: {
  routes: RouteDraft
  effective?: Record<DirectorCanvasNodeType, DirectorRouteView>
  managedProviders?: SettingsResponse['managedProviders']
  busy: boolean
  onChange: (nodeType: DirectorCanvasNodeType, provider: AiProviderId) => void
  onSave: () => void
  openPanels: Record<string, boolean>
  onPanelOpenChange: (id: string, open: boolean) => void
}) {
  return (
    <SettingsPanel
      id="routing"
      title="工作流能力路由"
      description="文本、视觉、配音和语音识别分别选择可用供应商"
      icon={Route}
      summary={`${ROUTE_ROWS.length} 条路由`}
      defaultOpen={false}
      open={openPanels['routing'] ?? false}
      onOpenChange={(open) => onPanelOpenChange('routing', open)}
    >
      {ROUTE_ROWS.map(([nodeType, label], index) => {
        const capability = capabilityFor(nodeType)
        const options = providersFor(capability)
          .filter((provider) => {
            const builtIn = managedProviders?.find((entry) =>
              entry.provider === provider)
            if (!builtIn) return true
            return builtIn.funding === 'byok'
              || builtIn.managedAllowed
              || routes[nodeType] === provider
          })
          .map((provider) => ({
            value: provider,
            label: PROVIDER_REGISTRY[provider].label,
          }))
        return (
          <div key={nodeType} data-testid={`route-${nodeType}`}>
            {index > 0 && <SettingsSeparator />}
            <SettingsField
              label={label}
              hint={`${capability} · 当前模型：${effective?.[nodeType]?.model ?? '读取中'}`}
            >
              <SegmentedControl
                options={options}
                value={routes[nodeType]}
                onChange={(value) => onChange(nodeType, value as AiProviderId)}
                className="max-w-full"
              />
            </SettingsField>
          </div>
        )
      })}
      <SettingsSeparator />
      <SettingsField
        label="应用路由"
        hint="媒体失败不会回滚文本产物；修复后从等待中的镜头继续"
      >
        <Button size="sm" variant="gray" disabled={busy} onClick={onSave}>
          保存全部路由
        </Button>
      </SettingsField>
    </SettingsPanel>
  )
}

function capabilityFor(nodeType: DirectorCanvasNodeType): ProviderCapability {
  if (nodeType === 'shot-sfx') return 'tts'
  if (nodeType === 'shot-subtitle') return 'asr'
  if (nodeType === 'shot-qa') return 'vision'
  return 'text'
}
