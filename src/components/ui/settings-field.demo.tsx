'use client'

import { useState } from 'react'
import { Button } from './button'
import { SettingsField } from './settings-field'
import { StatusPill } from './status-pill'
import { TextField } from './text-field'
import { Toggle } from './toggle'

/** SettingsField 示例：表单行（label + hint 在左，多控件区在右）。 */
export function SettingsFieldDemo() {
  const [enabled, setEnabled] = useState(true)
  return (
    <div className="w-[520px] max-w-full overflow-hidden rounded-xl border border-ds-border bg-ds-surface">
      <SettingsField label="API Key" hint="仅在校验成功后替换现有密钥">
        <TextField
          variant="ghost"
          placeholder="输入 API Key"
          className="min-w-[220px] flex-1"
        />
        <StatusPill variant="rendered" label="校验成功" />
        <Button size="sm" variant="tinted">
          校验并保存
        </Button>
      </SettingsField>
      <SettingsField
        label="失败后自动重试"
        hint="渲染失败时自动重试一次，仍失败则标记 failed"
      >
        <Toggle checked={enabled} onCheckedChange={setEnabled} />
      </SettingsField>
    </div>
  )
}
