'use client'

import { Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import type { AiProviderId, DirectorRouteView } from '@/features/ai/model-routing'
import {
  PROVIDER_REGISTRY,
  providersFor,
  type ProviderCapability,
} from '@/features/ai/provider-registry'
import type { CanvasNodeType } from '@/features/canvas/types'
import { ROUTE_ROWS, type RouteDraft } from './model-service-contract'

export function WorkflowRoutePanel({
  routes,
  effective,
  busy,
  onChange,
  onSave,
}: {
  routes: RouteDraft
  effective?: Record<CanvasNodeType, DirectorRouteView>
  busy: boolean
  onChange: (nodeType: CanvasNodeType, provider: AiProviderId) => void
  onSave: () => void
}) {
  return (
    <SettingsPanel
      id="routing"
      title="工作流能力路由"
      description="文本、视觉、配音和语音识别分别选择可用供应商"
      icon={Route}
      summary={`${ROUTE_ROWS.length} 条路由`}
      defaultOpen={false}
    >
      {ROUTE_ROWS.map(([nodeType, label], index) => {
        const capability = capabilityFor(nodeType)
        const options = providersFor(capability).map((provider) => ({
          value: provider,
          label: PROVIDER_REGISTRY[provider].label,
        }))
        return (
          <div key={nodeType} data-testid={`route-${nodeType}`}>
            {index > 0 && <SettingsSeparator />}
            <SettingsRow
              label={label}
              className="h-auto min-h-11 flex-col items-stretch gap-2 py-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
                <span className="text-[11px] font-medium uppercase text-ds-text-muted">
                  {capability}
                </span>
                <SegmentedControl
                  options={options}
                  value={routes[nodeType]}
                  onChange={(value) => onChange(nodeType, value as AiProviderId)}
                  className="max-w-full"
                />
                <span className="text-[11px] text-ds-text-muted">
                  当前模型：{effective?.[nodeType]?.model ?? '读取中'}
                </span>
              </div>
            </SettingsRow>
          </div>
        )
      })}
      <SettingsSeparator />
      <SettingsRow label="应用路由">
        <span className="text-xs text-ds-text-muted">
          媒体失败不会回滚文本产物；修复后从等待中的镜头继续
        </span>
        <Button size="sm" variant="gray" disabled={busy} onClick={onSave}>
          保存全部路由
        </Button>
      </SettingsRow>
    </SettingsPanel>
  )
}

function capabilityFor(nodeType: CanvasNodeType): ProviderCapability {
  if (nodeType === 'shot-sfx') return 'tts'
  if (nodeType === 'shot-subtitle') return 'asr'
  if (nodeType === 'shot-qa') return 'vision'
  return 'text'
}
