'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsField } from '@/components/ui/settings-field'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import { useSaveFeedback } from './save-feedback'

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
  const { state: saveState, report } = useSaveFeedback()

  async function save() {
    const ok = await onSave(apiKey)
    if (ok) setApiKey('')
    report(ok)
  }

  return (
    <div className="flex flex-col">
      <SettingsSeparator />
      <SettingsField label={title} hint={description}>
        <StatusPill
          variant={configured ? 'rendered' : 'pending'}
          label={configured ? '已配置' : '未配置'}
        />
      </SettingsField>
      <SettingsSeparator />
      <SettingsField label="API Key">
        <TextField
          aria-label={keyLabel}
          type="password"
          variant="ghost"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={configured ? '输入新 Key 以更新并校验' : '输入 API Key'}
          className="min-w-[220px] flex-1"
        />
      </SettingsField>
      {fields.map((field) => (
        <div key={field.label}>
          <SettingsSeparator />
          <SettingsField label={field.label} hint={field.note}>
            <TextField
              aria-label={`${keyLabel} ${field.label}`}
              variant="ghost"
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder={field.placeholder}
              className="w-full max-w-[480px]"
            />
          </SettingsField>
        </div>
      ))}
      {extra}
      <SettingsSeparator />
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5">
        <span className="mr-auto text-xs text-ds-text-muted">{saveHint}</span>
        {saveState === 'success' && (
          <StatusPill variant="rendered" label="校验成功" />
        )}
        {saveState === 'error' && (
          <StatusPill variant="failed" label="校验失败" />
        )}
        <Button
          size="sm"
          variant="tinted"
          disabled={busy || !apiKey.trim()}
          onClick={() => void save()}
        >
          {busy ? '校验中…' : '校验并保存'}
        </Button>
      </div>
    </div>
  )
}
