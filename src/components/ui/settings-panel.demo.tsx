'use client'

import { Cpu } from 'lucide-react'
import { SettingsPanel } from './settings-panel'
import { SettingsRow } from './settings-row'
import { SettingsSeparator } from './settings-group'

/** SettingsPanel 示例：长设置页使用的可折叠公共面板。 */
export function SettingsPanelDemo() {
  return (
    <div className="w-[520px] max-w-full">
      <SettingsPanel
        title="运行与导出"
        description="渲染并发、输出规格与恢复能力"
        icon={Cpu}
        summary="3 项"
      >
        <SettingsRow label="渲染并发数" value="8" />
        <SettingsSeparator />
        <SettingsRow label="导出分辨率" value="1080×1920" />
      </SettingsPanel>
    </div>
  )
}
