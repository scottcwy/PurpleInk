import { Tooltip } from './tooltip'

/** Tooltip 示例（/playbook 展示单元）。 */
export function TooltipDemo() {
  return (
    <Tooltip content="重渲此镜">
      <span className="cursor-help text-ds-text-muted">悬停查看提示</span>
    </Tooltip>
  )
}
