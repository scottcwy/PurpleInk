'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'

/**
 * 一个自定义 OpenAI 兼容接入点的配置段。
 *
 * 三个端点（文本与视觉 / TTS / ASR）复用同一个段，而不是把结构复制三遍。每段自带
 * API Key 输入与独立的「校验并保存」——它们是三份独立凭据，一次保存只能动其中一份。
 */
export interface EndpointField {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** 可选的字段级说明，用于如实标注留空后果或未验证状态。 */
  note?: ReactNode
}

export function OpenAiCompatibleEndpointSection({
  title,
  description,
  configured,
  busy,
  fields,
  extra,
  keyLabel,
  saveHint,
  onSave,
}: {
  title: string
  description: string
  configured: boolean
  busy: boolean
  fields: EndpointField[]
  /** 非文本输入的附加控件（例如音频格式选择、能力说明）。 */
  extra?: ReactNode
  keyLabel: string
  saveHint: string
  onSave: (apiKey: string) => Promise<boolean>
}) {
  const [apiKey, setApiKey] = useState('')

  async function save() {
    if (await onSave(apiKey)) setApiKey('')
  }

  return (
    <div className="flex flex-col">
      <SettingsSeparator />
      <SettingsRow
        label={title}
        className="h-auto min-h-11 flex-col items-stretch gap-1 py-3 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="text-[12px] text-ds-text-muted">{description}</span>
          <StatusPill
            variant={configured ? 'rendered' : 'pending'}
            label={configured ? '已配置' : '未配置'}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label="API Key"
        className="h-auto min-h-11 flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
          <TextField
            aria-label={keyLabel}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={configured ? '输入新 Key 以更新并校验' : '输入 API Key'}
            className="min-w-[180px] flex-1"
          />
        </div>
      </SettingsRow>
      {fields.map((field) => (
        <SettingsRow
          key={field.label}
          label={field.label}
          className="h-auto min-h-11 flex-col items-stretch gap-1 py-2 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
            <TextField
              aria-label={`${keyLabel} ${field.label}`}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder={field.placeholder}
              className="w-full max-w-[320px]"
            />
            {field.note && (
              <span className="text-[11px] leading-4 text-ds-text-muted">
                {field.note}
              </span>
            )}
          </div>
        </SettingsRow>
      ))}
      {extra}
      <SettingsRow label="保存">
        <span className="hidden text-[12px] text-ds-text-muted sm:inline">
          {saveHint}
        </span>
        <Button
          size="sm"
          variant="gray"
          disabled={busy || !apiKey.trim()}
          onClick={() => void save()}
        >
          校验并保存
        </Button>
      </SettingsRow>
    </div>
  )
}
