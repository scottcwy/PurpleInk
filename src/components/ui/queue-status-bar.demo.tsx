import { QueueStatusBar } from './queue-status-bar'

/** QueueStatusBar 示例（/playbook 展示单元）。 */
export function QueueStatusBarDemo() {
  return (
    <div className="space-y-3">
      <QueueStatusBar
        completed={2}
        active={1}
        waiting={0}
        failed={0}
        total={8}
        label="套餐并发 3/3 · 5 个分镜排队"
      />
      <QueueStatusBar
        variant="glass"
        completed={5}
        active={0}
        waiting={0}
        failed={0}
        total={5}
        label="glass 变体 · 悬浮于画布 DAG 之上"
      />
    </div>
  )
}
