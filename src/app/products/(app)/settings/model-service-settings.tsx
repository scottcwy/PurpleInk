'use client'

import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import type { AiProviderId } from '@/features/ai/model-routing'
import type { DirectorCanvasNodeType } from '@/features/canvas/types'
import {
  ROUTE_ROWS,
  type LaneQuotasDraft,
  type OpenAiCompatibleAsrDraft,
  type OpenAiCompatibleDraft,
  type OpenAiCompatibleTtsDraft,
  type ReadyModelSettingsController,
  type RouteDraft,
  type SettingsResponse,
} from './model-service-contract'
import { ModelServicePanels } from './model-service-panels'

type ModelSettingsController =
  | { ready: false }
  | ReadyModelSettingsController

export function ModelServiceSettings() {
  const controller = useModelSettingsController()
  if (!controller.ready) return <ModelSettingsSkeleton />
  return (
    <ModelServicePanels
      controller={controller}
      openPanels={{}}
      onPanelOpenChange={() => undefined}
    />
  )
}

/**
 * 服务端投影 → 客户端 draft 的写入口集合。
 *
 * 收成一个对象而不是并排的位置参数：字段增加到十个同类型回调时，位置参数极易错位，
 * 而这些回调全是 `(value) => void`，编译器帮不上忙。
 */
interface DraftSetters {
  setData: (body: SettingsResponse) => void
  setCustomOpenAi: (draft: OpenAiCompatibleDraft) => void
  setCustomOpenAiTts: (draft: OpenAiCompatibleTtsDraft) => void
  setCustomOpenAiAsr: (draft: OpenAiCompatibleAsrDraft) => void
  setRoutes: (routes: RouteDraft) => void
  setLaneQuotas: (draft: LaneQuotasDraft) => void
}

export function useModelSettingsController(): ModelSettingsController {
  const [data, setData] = useState<SettingsResponse>()
  const [customOpenAiDraft, setCustomOpenAi] = useState<OpenAiCompatibleDraft>()
  const [customOpenAiTtsDraft, setCustomOpenAiTts] = useState<OpenAiCompatibleTtsDraft>()
  const [customOpenAiAsrDraft, setCustomOpenAiAsr] = useState<OpenAiCompatibleAsrDraft>()
  const [routes, setRoutes] = useState<RouteDraft>()
  const [laneQuotasDraft, setLaneQuotas] = useState<LaneQuotasDraft>({
    directorStageConcurrency: '',
    renderShotConcurrency: '',
  })
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const setters = useMemo<DraftSetters>(() => ({
    setData,
    setCustomOpenAi,
    setCustomOpenAiTts,
    setCustomOpenAiAsr,
    setRoutes,
    setLaneQuotas,
  }), [])

  useSettingsLoader(setters, setError)
  const submit = useSettingsSubmitter(setters, setBusy, setError)

  function setRoute(nodeType: DirectorCanvasNodeType, provider: AiProviderId) {
    setRoutes((current) => current && { ...current, [nodeType]: provider })
  }
  function setCustomOpenAiField(field: keyof OpenAiCompatibleDraft, value: string) {
    setCustomOpenAi((current) => current && { ...current, [field]: value })
  }
  function setCustomOpenAiTtsField<K extends keyof OpenAiCompatibleTtsDraft>(
    field: K,
    value: OpenAiCompatibleTtsDraft[K],
  ) {
    setCustomOpenAiTts((current) => current && { ...current, [field]: value })
  }
  function setCustomOpenAiAsrField(
    field: keyof OpenAiCompatibleAsrDraft,
    value: string,
  ) {
    setCustomOpenAiAsr((current) => current && { ...current, [field]: value })
  }
  function setLaneQuotaField(field: keyof LaneQuotasDraft, value: string) {
    setLaneQuotas((current) => ({ ...current, [field]: value }))
  }

  if (
    !data
    || !customOpenAiDraft
    || !customOpenAiTtsDraft
    || !customOpenAiAsrDraft
    || !routes
  ) {
    return { ready: false }
  }
  return {
    ready: true,
    data,
    customOpenAiDraft,
    customOpenAiTtsDraft,
    customOpenAiAsrDraft,
    routes,
    laneQuotasDraft,
    busy,
    error,
    setCustomOpenAiField,
    setCustomOpenAiTtsField,
    setCustomOpenAiAsrField,
    setRoute,
    setLaneQuotaField,
    submit,
  }
}

function useSettingsLoader(
  setters: DraftSetters,
  setError: (error: string) => void,
) {
  useEffect(() => {
    void loadSettings()
      .then((body) => applyResponse(body, setters))
      .catch(() => setError('模型设置加载失败'))
  }, [setError, setters])
}

function useSettingsSubmitter(
  setters: DraftSetters,
  setBusy: (busy?: string) => void,
  setError: (error?: string) => void,
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
        return { ok: false as const, body }
      }
      applyResponse(body, setters)
      return { ok: true as const, body }
    } catch {
      setError('模型设置请求失败')
      return { ok: false as const, body: {} as SettingsResponse }
    } finally {
      setBusy(undefined)
    }
  }
}

function ModelSettingsSkeleton() {
  return (
    <SettingsPanel
      title="模型服务"
      description="正在读取真实 Provider Registry"
      icon={SlidersHorizontal}
    >
      <SettingsRow label="正在读取真实配置">
        <Skeleton className="h-9 w-[260px] rounded-md" />
      </SettingsRow>
    </SettingsPanel>
  )
}

async function loadSettings(): Promise<SettingsResponse> {
  const response = await fetch('/api/settings')
  if (!response.ok) throw new Error('加载失败')
  return response.json() as Promise<SettingsResponse>
}

function applyResponse(body: SettingsResponse, setters: DraftSetters) {
  setters.setData(body)
  setters.setCustomOpenAi({
    baseUrl: body.customOpenAi?.baseUrl?.value ?? '',
    textModel: body.customOpenAi?.textModel?.value ?? '',
    visionModel: body.customOpenAi?.visionModel?.value ?? '',
  })
  setters.setCustomOpenAiTts({
    baseUrl: body.customOpenAiTts?.baseUrl?.value ?? '',
    model: body.customOpenAiTts?.model?.value ?? '',
    voice: body.customOpenAiTts?.voice?.value ?? '',
    audioFormat: body.customOpenAiTts?.audioFormat?.value === 'wav' ? 'wav' : 'mp3',
  })
  setters.setCustomOpenAiAsr({
    baseUrl: body.customOpenAiAsr?.baseUrl?.value ?? '',
    model: body.customOpenAiAsr?.model?.value ?? '',
  })
  setters.setRoutes(
    Object.fromEntries(
      ROUTE_ROWS.map(([nodeType]) => [
        nodeType,
        body.routes?.[nodeType]?.provider ?? 'stepfun',
      ]),
    ) as RouteDraft,
  )
  setters.setLaneQuotas({
    directorStageConcurrency:
      body.laneQuotas?.directorStage.source === 'settings'
        ? String(body.laneQuotas.directorStage.value)
        : '',
    renderShotConcurrency:
      body.laneQuotas?.renderShot.source === 'settings'
        ? String(body.laneQuotas.renderShot.value)
        : '',
  })
}
