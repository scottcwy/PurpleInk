import { QueueStatusBar } from './queue-status-bar'

/** QueueStatusBar 示例（/playbook 展示单元）。 */
export function QueueStatusBarDemo() {
  return <QueueStatusBar completed={2} active={1} failed={0} total={8} />
}
