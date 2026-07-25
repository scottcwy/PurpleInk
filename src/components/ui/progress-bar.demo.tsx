import { ProgressBar } from './progress-bar'

/** ProgressBar 示例（/playbook 展示单元）。 */
export function ProgressBarDemo() {
  return (
    <div className="w-60">
      <ProgressBar label="生成进度" value={62} />
    </div>
  )
}
