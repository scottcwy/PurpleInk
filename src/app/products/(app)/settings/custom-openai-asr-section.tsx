'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { OpenAiCompatibleEndpointSection } from './openai-compatible-endpoint-section'
import type { ReadyModelSettingsController } from './model-service-contract'

/**
 * 自定义兼容 ASR 接入点。
 *
 * 校验用一段内存生成的无语音合成音，判据是端点返回可解析的 2xx，不是转写非空。
 * 少数端点会直接拒收这类输入——此时弹窗说明，用户可改为只校验凭据后保存，
 * 那条路径仍要 `GET /models` 通过，并把字幕对齐如实降级为整段。
 */
export function CustomOpenAiAsrSection({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  const draft = controller.customOpenAiAsrDraft
  const view = controller.data.customOpenAiAsr
  const [pendingKey, setPendingKey] = useState<string>()

  async function save(apiKey: string, credentialOnly?: boolean) {
    const result = await controller.submit({
      customOpenAiAsr: { apiKey, ...draft, ...(credentialOnly ? { credentialOnly } : {}) },
    }, 'custom-openai-asr')
    if (!result.ok && result.body.reason === 'asr-transcription-rejected') {
      setPendingKey(apiKey)
      return false
    }
    setPendingKey(undefined)
    return result.ok
  }

  return (
    <>
      <OpenAiCompatibleEndpointSection
        title="ASR（字幕转写）"
        description="POST /audio/transcriptions"
        configured={view?.configured === true}
        busy={controller.busy === 'custom-openai-asr'}
        keyLabel="自定义兼容 ASR"
        saveHint="保存时用一段 1 秒合成音真实转写一次"
        fields={[
          {
            label: 'OpenAI 兼容端点',
            value: draft.baseUrl,
            placeholder: 'https://example.com/v1',
            onChange: (value) => controller.setCustomOpenAiAsrField('baseUrl', value),
          },
          {
            label: 'ASR 模型 ID',
            value: draft.model,
            placeholder: '例如 whisper-1',
            onChange: (value) => controller.setCustomOpenAiAsrField('model', value),
            note: timestampNote(view),
          },
        ]}
        onSave={(apiKey) => save(apiKey)}
      />
      <Dialog
        open={pendingKey !== undefined}
        onClose={() => setPendingKey(undefined)}
        placement="center"
        title="该端点拒绝了转写校验"
        description={
          '校验使用一段 1 秒、无语音内容的合成音，只为确认端点、凭据与响应格式可用。'
          + '部分端点会直接拒收这类输入。你可以改为只校验凭据后保存——'
          + '此时时间戳能力未经验证，字幕会按整段音频对齐，而不是逐句。'
        }
        actions={
          <>
            <Button size="sm" variant="gray" onClick={() => setPendingKey(undefined)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="tinted"
              disabled={controller.busy === 'custom-openai-asr'}
              onClick={() => {
                const apiKey = pendingKey
                if (apiKey) void save(apiKey, true)
              }}
            >
              仅校验凭据并保存
            </Button>
          </>
        }
      />
    </>
  )
}

/** 如实说明时间戳能力的来源与后果，不允许在未验证时暗示有逐句对齐。 */
function timestampNote(
  view: ReadyModelSettingsController['data']['customOpenAiAsr'],
): string | undefined {
  if (!view?.configured) return undefined
  if (view.verification === 'credential-only') {
    return '仅校验过凭据：时间戳能力未验证，字幕按整段音频对齐。'
  }
  return view.timestampMode === 'segment'
    ? '校验确认该端点返回分段时间戳，字幕逐段对齐。'
    : '校验确认该端点不返回时间戳，字幕按整段音频对齐。'
}
