import { Film } from 'lucide-react'
import { TimelineTrack } from './timeline-track'

/** TimelineTrack 示例（/playbook 展示单元）。 */
export function TimelineTrackDemo() {
  return (
    <TimelineTrack
      icon={Film}
      label="分镜"
      clips={[
        { start: 4, width: 92, label: '开场' },
        { start: 104, width: 92, label: '概念' },
        { start: 204, width: 92, label: '图解' },
        { start: 304, width: 92, label: '代码' },
        { start: 404, width: 92, label: '案例' },
        { start: 504, width: 92, label: '总结' },
      ]}
    />
  )
}
