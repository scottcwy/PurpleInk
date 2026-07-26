'use client'

import { Bot, KeyRound, Route } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import type { AiProviderId, DirectorRouteView } from '@/features/ai/model-routing'
import type { CanvasNodeType } from '@/features/canvas/types'
import { CustomOpenAiProviderPanel } from './custom-openai-provider-panel'
import {
  GEMINI_FIELDS,
  MODEL_ROUTE_ROWS,
  STEPFUN_FIELDS,
  type ReadyModelSettingsController,
  type RouteDraft,
} from './model-service-contract'

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'stepfun', label: '阶跃星辰' },
  { value: 'openai-compatible', label: '自定义兼容模型' },
]

export function ModelServicePanels({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  return (
    <>
      <div
        id="providers"
        className="flex min-w-0 scroll-mt-5 flex-col gap-3"
      >
        <ProviderSection
          title="StepFun 模型服务"
          provider="StepFun"
          configured={Boolean(controller.data.configured)}
          fields={STEPFUN_FIELDS}
          draft={controller.stepfunDraft}
          view={controller.data.models}
          busy={controller.busy}
          onDraft={controller.setStepfunField}
          onSaveKey={(apiKey) => controller.submit({ apiKey }, 'stepfun-key')}
          onSaveFields={() =>
            controller.submit(controller.stepfunDraft, 'stepfun-fields')
          }
        />
        <CustomOpenAiProviderPanel controller={controller} />
        <ProviderSection
          title="Gemini 模型服务"
          provider="Gemini"
          configured={Boolean(controller.data.geminiConfigured)}
          fields={GEMINI_FIELDS}
          draft={controller.geminiDraft}
          view={controller.data.gemini}
          busy={controller.busy}
          onDraft={controller.setGeminiField}
          onSaveKey={(apiKey) =>
            controller.submit(
              { gemini: { apiKey, ...controller.geminiDraft } },
              'gemini-key',
            )
          }
          onSaveFields={() =>
            controller.submit(
              { gemini: controller.geminiDraft },
              'gemini-fields',
            )
          }
        />
      </div>
      <RoutingPanel
        routes={controller.routes}
        effective={controller.data.routes}
        busy={controller.busy === 'routes'}
        onChange={controller.setRoute}
        onSave={() => controller.submit({ routes: controller.routes }, 'routes')}
      />
      {controller.error && (
        <Toast variant="error" title="模型配置失败" body={controller.error} />
      )}
    </>
  )
}

interface ProviderSectionProps<T extends string> {
  title: string
  provider: 'StepFun' | 'Gemini'
  configured: boolean
  fields: Array<[T, string]>
  draft: Record<T, string>
  view?: Record<T, { value: string; source: string }>
  busy?: string
  onDraft: (field: T, value: string) => void
  onSaveKey: (apiKey: string) => Promise<boolean>
  onSaveFields: () => void
}

function ProviderSection<T extends string>({
  title,
  provider,
  configured,
  fields,
  draft,
  view,
  busy,
  onDraft,
  onSaveKey,
  onSaveFields,
}: ProviderSectionProps<T>) {
  const [apiKey, setApiKey] = useState('')
  const keyBusy = busy === `${provider.toLowerCase()}-key`

  async function saveKey() {
    if (await onSaveKey(apiKey)) setApiKey('')
  }

  return (
    <SettingsPanel
      id={`provider-${provider.toLowerCase()}`}
      title={title}
      description="凭据验证成功后才会替换已保存的 Secret"
      icon={provider === 'StepFun' ? KeyRound : Bot}
      summary={configured ? '已配置' : '未配置'}
    >
      <ProviderKeyRow
        provider={provider}
        configured={configured}
        value={apiKey}
        busy={keyBusy}
        onChange={setApiKey}
        onSave={() => void saveKey()}
      />
      <ProviderFieldRows
        provider={provider}
        fields={fields}
        draft={draft}
        view={view}
        onDraft={onDraft}
      />
      <ProviderFooter
        provider={provider}
        busy={Boolean(busy)}
        onSave={onSaveFields}
      />
    </SettingsPanel>
  )
}

function ProviderKeyRow({
  provider,
  configured,
  value,
  busy,
  onChange,
  onSave,
}: {
  provider: 'StepFun' | 'Gemini'
  configured: boolean
  value: string
  busy: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <SettingsRow
      label="API Key"
      className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
        <TextField
          aria-label={`${provider} API Key`}
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured ? '已配置；输入新 Key 可替换' : '输入 API Key'}
          className="min-w-[180px] flex-1"
        />
        <Button
          size="sm"
          variant="gray"
          disabled={!value.trim() || busy}
          onClick={onSave}
        >
          校验并保存
        </Button>
        <StatusPill
          variant={configured ? 'rendered' : 'pending'}
          label={configured ? '已配置' : '未配置'}
        />
      </div>
    </SettingsRow>
  )
}

function ProviderFieldRows<T extends string>({
  provider,
  fields,
  draft,
  view,
  onDraft,
}: {
  provider: 'StepFun' | 'Gemini'
  fields: Array<[T, string]>
  draft: Record<T, string>
  view?: Record<T, { value: string; source: string }>
  onDraft: (field: T, value: string) => void
}) {
  return fields.map(([field, label]) => (
    <div key={field}>
      <SettingsSeparator />
      <SettingsRow label={label}>
        <TextField
          aria-label={`${provider} ${label}`}
          value={draft[field]}
          onChange={(event) => onDraft(field, event.target.value)}
          placeholder={placeholderFor(view?.[field])}
          className="w-full max-w-[260px]"
        />
      </SettingsRow>
    </div>
  ))
}

function ProviderFooter({
  provider,
  busy,
  onSave,
}: {
  provider: 'StepFun' | 'Gemini'
  busy: boolean
  onSave: () => void
}) {
  return (
    <>
      <SettingsSeparator />
      <SettingsRow label="配置">
        <span className="hidden text-[12px] text-ds-text-muted sm:inline">
          留空回退环境变量/内置默认
        </span>
        <Button size="sm" variant="gray" onClick={onSave} disabled={busy}>
          保存
        </Button>
      </SettingsRow>
      {provider === 'StepFun' && (
        <>
          <SettingsSeparator />
          <SettingsRow
            label="固定音频能力"
            value="TTS 配音 · ASR 字幕时间轴"
          />
        </>
      )}
    </>
  )
}

function RoutingPanel({
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
      title="节点模型路由"
      description="按 Pipeline 节点选择 Director 与 Vision Provider"
      icon={Route}
      summary={`${MODEL_ROUTE_ROWS.length} 个节点`}
      defaultOpen={false}
    >
      {MODEL_ROUTE_ROWS.map(([nodeType, label], index) => (
        <div key={nodeType} data-testid={`route-${nodeType}`}>
          {index > 0 && <SettingsSeparator />}
          <SettingsRow
            label={label}
            className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
          >
            <SegmentedControl
              options={PROVIDER_OPTIONS}
              value={routes[nodeType]}
              onChange={(value) => onChange(nodeType, value as AiProviderId)}
            />
            <span className="text-[12px] text-ds-text-muted">
              {effective?.[nodeType]?.model}
            </span>
          </SettingsRow>
        </div>
      ))}
      <SettingsSeparator />
      <SettingsRow
        label="路由配置"
        className="h-auto min-h-11 flex-wrap gap-2 py-2"
      >
        <span className="text-[12px] text-ds-text-muted">
          TTS/ASR 始终使用阶跃星辰
        </span>
        <Button size="sm" variant="gray" disabled={busy} onClick={onSave}>
          保存
        </Button>
      </SettingsRow>
    </SettingsPanel>
  )
}

function placeholderFor(field?: { value: string; source: string }): string {
  if (!field) return ''
  if (field.source === 'env') return `${field.value}（环境变量）`
  if (field.source === 'default') return `${field.value}（内置默认）`
  return field.value
}
