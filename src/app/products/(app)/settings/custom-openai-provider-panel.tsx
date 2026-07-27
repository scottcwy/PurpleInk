'use client'

import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import type { ReadyModelSettingsController } from './model-service-contract'

export function CustomOpenAiProviderPanel({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  const [apiKey, setApiKey] = useState('')
  const configured = controller.data.customOpenAi?.configured === true
  const busy = controller.busy === 'custom-openai'

  async function save() {
    const saved = await controller.submit({
      customOpenAi: { apiKey, ...controller.customOpenAiDraft },
    }, 'custom-openai')
    if (saved) setApiKey('')
  }

  return (
    <SettingsPanel
      id="provider-openai-compatible"
      title="OpenAI 兼容模型服务"
      description="用于文本与视觉节点；文本模型与视觉模型分别校验。"
      icon={KeyRound}
      summary={configured ? '已配置' : '未配置'}
    >
      <SettingsRow
        label="API Key"
        className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
          <TextField
            aria-label="OpenAI 兼容 API Key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={configured ? '输入新 Key 以更新并校验' : '输入 API Key'}
            className="min-w-[180px] flex-1"
          />
          <StatusPill variant={configured ? 'rendered' : 'pending'} label={configured ? '已配置' : '未配置'} />
        </div>
      </SettingsRow>
      <SettingsRow label="OpenAI 兼容端点">
        <TextField
          aria-label="OpenAI 兼容端点"
          value={controller.customOpenAiDraft.baseUrl}
          onChange={(event) => controller.setCustomOpenAiField('baseUrl', event.target.value)}
          placeholder="https://example.com/v1"
          className="w-full max-w-[320px]"
        />
      </SettingsRow>
      <SettingsRow label="默认模型">
        <TextField
          aria-label="OpenAI 兼容默认模型"
          value={controller.customOpenAiDraft.textModel}
          onChange={(event) => controller.setCustomOpenAiField('textModel', event.target.value)}
          placeholder="文本模型 ID"
          className="w-full max-w-[320px]"
        />
      </SettingsRow>
      <SettingsRow label="视觉模型">
        <TextField
          aria-label="OpenAI 兼容视觉模型"
          value={controller.customOpenAiDraft.visionModel}
          onChange={(event) => controller.setCustomOpenAiField('visionModel', event.target.value)}
          placeholder="留空则本端点不承担视觉路由"
          className="w-full max-w-[320px]"
        />
      </SettingsRow>
      {/*
        常驻说明而非可关闭通知：这是会导致运行期失败的配置约束。用 warning 而不是
        info，因为填错会让分镜验收在 FINALIZE 阶段才失败。Toast 自带 TriangleAlert
        图标，状态不只靠色相表达。
      */}
      <div className="px-3 pb-2">
        <Toast
          variant="warning"
          title="视觉模型需要真的支持图像输入"
          body="保存时会用一张 8×8 探针图片单独校验该模型；纯文本模型会被拒绝。留空则分镜验收不能路由到本端点。"
          className="w-full"
        />
      </div>
      <SettingsRow label="配置">
        <span className="hidden text-[12px] text-ds-text-muted sm:inline">保存时将发起一次最小 Chat Completions 校验</span>
        <Button size="sm" variant="gray" disabled={busy || !apiKey.trim()} onClick={() => void save()}>
          校验并保存
        </Button>
      </SettingsRow>
    </SettingsPanel>
  )
}
