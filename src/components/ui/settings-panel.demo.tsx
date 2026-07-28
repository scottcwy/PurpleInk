'use client'

import { useState } from 'react'
import { Cpu } from 'lucide-react'
import { SettingsField } from './settings-field'
import { SettingsPanel } from './settings-panel'
import { SettingsRow } from './settings-row'
import { SettingsSeparator } from './settings-group'
import { Toggle } from './toggle'

/** SettingsPanel 示例：长设置页使用的可折叠公共面板（导航行 + 表单行组合）。 */
export function SettingsPanelDemo() {
  const [retry, setRetry] = useState(true)
  return (
    <div className="w-[520px] max-w-full">
      <SettingsPanel
        title="运行与导出"
        description="渲染并发、输出规格与恢复能力"
        icon={Cpu}
        summary="3 项"
        defaultOpen
      >
        <SettingsRow label="渲染并发数" value="8" chevron={false} />
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
