import { AudioLines, Captions, Film, Music } from 'lucide-react'
import { StatusPill } from './status-pill'
import { TimelineTrack } from './timeline-track'

/**
 * TimelineTrack 示例（/playbook 展示单元）。
 *
 * 覆盖四种形态：按时长排布的完整轨道、带计数与操作位的轨道、降饱和的关闭态、
 * 以及空轨道的说明文案。clip 宽度按比例给出，加起来不为 1 即代表中间有缺口。
 */
export function TimelineTrackDemo() {
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-1">
      <TimelineTrack
        icon={Film}
        label="分镜"
        meta="6/6"
        clips={[
          { start: 0, width: 0.14, label: '开场' },
          { start: 0.14, width: 0.19, label: '概念' },
          { start: 0.33, width: 0.24, label: '图解' },
          { start: 0.57, width: 0.21, label: '代码' },
          { start: 0.78, width: 0.13, label: '案例' },
          { start: 0.91, width: 0.09, label: '总结' },
        ]}
      />
      <TimelineTrack
        icon={Captions}
        label="字幕"
        meta="2/3"
        title="字幕就绪 2 / 3"
        action={<StatusPill variant="stale" label="1 镜待生成" />}
        clips={[
          { start: 0, width: 0.3, label: 'S001' },
          { start: 0.66, width: 0.34, label: 'S003' },
        ]}
      />
      <TimelineTrack
        icon={AudioLines}
        label="配音"
        muted
        emptyLabel="本次不入片"
        clips={[]}
      />
      <TimelineTrack
        icon={Music}
        label="音乐"
        muted
        emptyLabel="接口预留"
        clips={[]}
        action={<StatusPill variant="pending" label="未实现" />}
      />
    </div>
  )
}
