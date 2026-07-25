'use client'

import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import type { StepfunModelField } from '@/features/ai/config'
import type { GeminiConfigField } from '@/features/ai/gemini-config'
import type { AiProviderId } from '@/features/ai/model-routing'
import type { CanvasNodeType } from '@/features/canvas/types'
import {
  GEMINI_FIELDS,
  ROUTE_ROWS,
  STEPFUN_FIELDS,
  type GeminiDraft,
  type LaneQuotasDraft,
  type ReadyModelSettingsController,
  type RouteDraft,
  type SettingsResponse,
  type StepfunDraft,
} from './model-service-contract'
import { ModelServicePanels } from './model-service-panels'

type ModelSettingsController =
  | { ready: false }
  | ReadyModelSettingsController

export function ModelServiceSettings() {
  const controller = useModelSettingsController()
  if (!controller.ready) return <ModelSettingsSkeleton />
  return <ModelServicePanels controller={controller} />
}

export function useModelSettingsController(): ModelSettingsController {
  const [data, setData] = useState<SettingsResponse>()
  const [stepfunDraft, setStepfunDraft] = useState<StepfunDraft>()
  const [geminiDraft, setGeminiDraft] = useState<GeminiDraft>()
  const [routes, setRoutes] = useState<RouteDraft>()
  const [laneQuotasDraft, setLaneQuotasDraft] = useState<LaneQuotasDraft>({
    directorStageConcurrency: '',
    renderShotConcurrency: '',
  })
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  useSettingsLoader(
    setData,
    setStepfunDraft,
    setGeminiDraft,
    setRoutes,
    setLaneQuotasDraft,
    setError,
  )
  const submit = useSettingsSubmitter(
    setData,
    setStepfunDraft,
    setGeminiDraft,
    setRoutes,
    setLaneQuotasDraft,
    setBusy,
    setError,
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

  function setLaneQuotaField(
    field: keyof LaneQuotasDraft,
    value: string,
  ) {
    setLaneQuotasDraft((current) => ({ ...current, [field]: value }))
  }

  if (!data || !stepfunDraft || !geminiDraft || !routes) {
    return { ready: false }
  }
  return {
    ready: true,
    data,
    stepfunDraft,
    geminiDraft,
    routes,
    laneQuotasDraft,
    busy,
    error,
    setStepfunField,
    setGeminiField,
    setRoute,
    setLaneQuotaField,
    submit,
  }
}

function useSettingsLoader(
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void,
  setLaneQuotasDraft: (draft: LaneQuotasDraft) => void,
  setError: (error: string) => void,
) {
  useEffect(() => {
    void loadSettings()
      .then((body) =>
        applyResponse(
          body,
          setData,
          setStepfun,
          setGemini,
          setRoutes,
          setLaneQuotasDraft,
        ),
      )
      .catch(() => setError('模型设置加载失败'))
  }, [setData, setError, setGemini, setLaneQuotasDraft, setRoutes, setStepfun])
}

function useSettingsSubmitter(
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void,
  setLaneQuotasDraft: (draft: LaneQuotasDraft) => void,
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
        return false
      }
      applyResponse(body, setData, setStepfun, setGemini, setRoutes, setLaneQuotasDraft)
      return true
    } catch {
      setError('模型设置请求失败')
      return false
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

function applyResponse(
  body: SettingsResponse,
  setData: (body: SettingsResponse) => void,
  setStepfun: (draft: StepfunDraft) => void,
  setGemini: (draft: GeminiDraft) => void,
  setRoutes: (routes: RouteDraft) => void,
  setLaneQuotasDraft: (draft: LaneQuotasDraft) => void,
) {
  setData(body)
  setStepfun(draftFromView(STEPFUN_FIELDS, body.models))
  setGemini(draftFromView(GEMINI_FIELDS, body.gemini))
  setRoutes(
    Object.fromEntries(
      ROUTE_ROWS.map(([nodeType]) => [
        nodeType,
        body.routes?.[nodeType]?.provider ?? 'stepfun',
      ]),
    ) as RouteDraft,
  )
  setLaneQuotasDraft({
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

function draftFromView<T extends string>(
  fields: Array<[T, string]>,
  view?: Record<T, { value: string; source: string }>,
): Record<T, string> {
  return Object.fromEntries(
    fields.map(([field]) => [
      field,
      view?.[field]?.source === 'settings' ? view[field].value : '',
    ]),
  ) as Record<T, string>
}
