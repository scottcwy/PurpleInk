import { SettingsGroup, SettingsSeparator } from './settings-group'
import { SettingsRow } from './settings-row'

/** SettingsGroup 示例（/playbook 展示单元）。 */
export function SettingsGroupDemo() {
  return (
    <div className="w-120">
      <SettingsGroup>
        <SettingsRow label="分辨率" value="1080×1920 · 竖屏" />
        <SettingsSeparator />
        <SettingsRow label="帧率" value="30 fps" />
      </SettingsGroup>
    </div>
  )
}
