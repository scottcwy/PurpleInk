'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import type { StepfunConfigView, StepfunModelField } from '@/features/ai/config'
import type {
  GeminiConfigField,
  GeminiConfigView,
} from '@/features/ai/gemini-config'
import type {
  AiProviderId,
  DirectorRouteView,
} from '@/features/ai/model-routing'
import type { CanvasNodeType } from '@/features/canvas/types'

type StepfunDraft = Record<StepfunModelField, string>
type GeminiDraft = Record<GeminiConfigField, string>
type RouteDraft = Record<CanvasNodeType, AiProviderId>

const STEPFUN_FIELDS: Array<[StepfunModelField, string]> = [
  ['baseUrl', '端点'],
  ['chatModel', 'Chat 模型'],
  ['ttsModel', 'TTS 模型'],
  ['asrModel', 'ASR 模型'],
  ['visionModel', 'Vision 模型'],
]
const GEMINI_FIELDS: Array<[GeminiConfigField, string]> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['primaryModel', '主模型'],
  ['fastModel', '低延迟模型'],
]
const ROUTE_ROWS: Array<[CanvasNodeType, string]> = [
  ['script-import', '脚本导入 / INGEST'],
  ['shot-split', '导演拆分 / DIRECT'],
  ['shot-script', '分镜合同 / SHOT_SPEC'],
  ['shot-codegen', '代码生成 / FABRICATE'],
  ['score', '全片编排 / ASSEMBLE'],
  ['shot-sfx', '配音规划 / ASSEMBLE'],
  ['shot-subtitle', '字幕规划 / ASSEMBLE'],
  ['shot-qa', '分镜验收 / FINALIZE'],
  ['export', '终片交付 / FINALIZE'],
]
const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'stepfun', label: '阶跃星辰' },
]

interface SettingsResponse {
  configured?: boolean
  models?: StepfunConfigView
  geminiConfigured?: boolean
  gemini?: GeminiConfigView
  routes?: Record<CanvasNodeType, DirectorRouteView>
  error?: string
}

export function ModelServiceSettings() {
  const controller = useModelSettingsController()
  if (!controller.ready) return <ModelSettingsSkeleton />

  return (
    <>
      <ProviderSettings controller={controller} />
      <RoutingSection
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

function useModelSettingsController() {
  const [data, setData] = useState<SettingsResponse>()
  const [stepfunDraft, setStepfunDraft] = useState<StepfunDraft>()
  const [geminiDraft, setGeminiDraft] = useState<GeminiDraft>()
  const [routes, setRoutes] = useState<RouteDraft>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  useSettingsLoader(
    setData,
    setStepfunDraft,
    setGeminiDraft,
    setRoutes,
    setError
  )
  const submit = useSettingsSubmitter(
    setData,
    setStepfunDraft,
    setGeminiDraft,
    setRoutes,
    setBusy,
    setError
  )

  function setRoute(nodeType: CanvasNodeType, provider: AiProviderId) {
    setRoutes((current) => current && { ...current, [nodeType]: provider })
  }

  function setStepfunField(field: StepfunModelField, value: string) {
    setStepfunDraft((current) => current && { ...current, [field]: value })
  }

  function setGeminiField(field: GeminiConfigField, value: string) {
    setGeminiDraft((current) => current && { ...current, [field]: value })
  }

  if (!data || !stepfunDraft || !geminiDraft || !routes) {
    return { ready: false as const }
  }
  return {
    ready: true as const,
    data,
    stepfunDraft,
    geminiDraft,
    routes,
    busy,
    error,
    setStepfunField,
    setGeminiField,
    setRoute,
    submit,
  }
}

function useSettingsLoader(
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void,
  setError: (error: string) => void
) {
  useEffect(() => {
    void loadSettings()
      .then((body) => applyResponse(body, setData, setStepfun, setGemini, setRoutes))
      .catch(() => setError('模型设置加载失败'))
  }, [setData, setError, setGemini, setRoutes, setStepfun])
}

function useSettingsSubmitter(
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void,
  setBusy: (busy?: string) => void,
  setError: (error?: string) => void
) {
  return async (payload: Record<string, unknown>, action: string) => {
    setBusy(action)
    setError(undefined)
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as SettingsResponse
      if (!response.ok) {
        setError(body.error ?? '模型设置保存失败')
        return false
      }
      applyResponse(body, setData, setStepfun, setGemini, setRoutes)
      return true
    } catch {
      setError('模型设置请求失败')
      return false
    } finally {
      setBusy(undefined)
    }
  }
}

type ReadyController = Extract<
  ReturnType<typeof useModelSettingsController>,
  { ready: true }
>

function ProviderSettings({ controller }: { controller: ReadyController }) {
  return (
    <>
      <ProviderSection
        title="STEPFUN 模型服务"
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
      <ProviderSection
        title="GEMINI 模型服务"
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
            'gemini-key'
          )
        }
        onSaveFields={() =>
          controller.submit(
            { gemini: controller.geminiDraft },
            'gemini-fields'
          )
        }
      />
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
    <SettingsSection title={title}>
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
    </SettingsSection>
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
    <SettingsRow label="API Key">
      <TextField
        aria-label={`${provider} API Key`}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? '已配置；输入新 Key 可替换' : '输入 API Key'}
        className="w-[260px]"
      />
      <Button size="sm" variant="gray" disabled={!value.trim() || busy} onClick={onSave}>
        校验并保存
      </Button>
      <StatusPill
        variant={configured ? 'rendered' : 'pending'}
        label={configured ? '已配置' : '未配置'}
      />
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
          className="w-[260px]"
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
        <span className="text-[13px] text-label-tertiary">
          留空回退环境变量/内置默认
        </span>
        <Button size="sm" variant="gray" onClick={onSave} disabled={busy}>
          保存
        </Button>
      </SettingsRow>
      {provider === 'StepFun' && <StepfunAudioBoundary />}
    </>
  )
}

function StepfunAudioBoundary() {
  return (
    <>
      <SettingsSeparator />
      <SettingsRow
        label="固定音频能力"
        value="TTS 配音 · ASR 字幕时间轴（不随节点路由切换）"
      />
    </>
  )
}

function RoutingSection({
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
    <SettingsSection title="节点模型路由" testId="model-routing-section">
      {ROUTE_ROWS.map(([nodeType, label], index) => (
        <div key={nodeType} data-testid={`route-${nodeType}`}>
          {index > 0 && <SettingsSeparator />}
          <SettingsRow label={label}>
            <SegmentedControl
              options={PROVIDER_OPTIONS}
              value={routes[nodeType]}
              onChange={(value) => onChange(nodeType, value as AiProviderId)}
            />
            <span className="text-[12px] text-label-tertiary">
              {effective?.[nodeType]?.model}
            </span>
          </SettingsRow>
        </div>
      ))}
      <SettingsSeparator />
      <SettingsRow label="路由配置">
        <span className="text-[13px] text-label-tertiary">
          仅影响 Director 与 Vision；TTS/ASR 始终使用阶跃星辰
        </span>
        <Button size="sm" variant="gray" disabled={busy} onClick={onSave}>
          保存
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

function ModelSettingsSkeleton() {
  return (
    <SettingsSection title="模型服务">
      <SettingsRow label="正在读取真实配置">
        <Skeleton className="h-9 w-[260px] rounded-md" />
      </SettingsRow>
    </SettingsSection>
  )
}

function SettingsSection({
  title,
  children,
  testId,
}: {
  title: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-2 text-xs text-label-tertiary">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}

async function loadSettings(): Promise<SettingsResponse> {
  const response = await fetch('/api/settings')
  if (!response.ok) throw new Error('加载失败')
  return response.json() as Promise<SettingsResponse>
}

function applyResponse(
  body: SettingsResponse,
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void
) {
  setData(body)
  setStepfun(draftFromView(STEPFUN_FIELDS, body.models))
  setGemini(draftFromView(GEMINI_FIELDS, body.gemini))
  setRoutes(
    Object.fromEntries(
      ROUTE_ROWS.map(([nodeType]) => [
        nodeType,
        body.routes?.[nodeType]?.provider ?? 'stepfun',
      ])
    ) as RouteDraft
  )
}

function draftFromView<T extends string>(
  fields: Array<[T, string]>,
  view?: Record<T, { value: string; source: string }>
): Record<T, string> {
  return Object.fromEntries(
    fields.map(([field]) => [
      field,
      view?.[field]?.source === 'settings' ? view[field].value : '',
    ])
  ) as Record<T, string>
}

function placeholderFor(field?: { value: string; source: string }): string {
  if (!field) return ''
  if (field.source === 'env') return `${field.value}（环境变量）`
  if (field.source === 'default') return `${field.value}（内置默认）`
  return field.value
}
