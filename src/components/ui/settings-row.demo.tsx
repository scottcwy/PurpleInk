import { SettingsRow } from './settings-row'

/** SettingsRow 示例（/playbook 展示单元）。 */
export function SettingsRowDemo() {
  return (
    <div className="w-120">
      <SettingsRow label="API Key" value="step-1-8k" />
    </div>
  )
}
