'use client'

import { useState } from 'react'
import { Cpu } from 'lucide-react'
import { SettingsField } from './settings-field'
import { SettingsPanel } from './settings-panel'
import { SettingsRow } from './settings-row'
import { SettingsSeparator } from './settings-group'
import { StatusPill } from './status-pill'
import { Toggle } from './toggle'

/** SettingsPanel 示例：长设置页使用的可折叠公共面板（导航行 + 表单行组合）。 */
export function SettingsPanelDemo() {
  const [retry, setRetry] = useState(true)
  return (
    <div className="w-[520px] max-w-full">
      <SettingsPanel
        title="运行与导出"
        description="套餐分镜并发、本地渲染并发"
        icon={Cpu}
        summary="账号级 · 重启后生效"
        defaultOpen
      >
        <SettingsRow label="AI 分镜并发" chevron={false}>
          <span className="flex items-center gap-2 text-[13px] text-ds-text-muted">
            <StatusPill variant="pending" label="3 个" />
            套餐上限，只读
          </span>
        </SettingsRow>
        <SettingsSeparator />
        <SettingsRow label="渲染并发" value="8" chevron={false} />
        <SettingsSeparator />
        <SettingsRow label="导出分辨率" value="1920×1080" chevron={false} />
        <SettingsSeparator />
        <SettingsField label="失败后自动重试" hint="仍失败则标记 failed">
          <Toggle checked={retry} onCheckedChange={setRetry} />
        </SettingsField>
      </SettingsPanel>
    </div>
  )
}
