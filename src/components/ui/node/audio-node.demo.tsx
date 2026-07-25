import { AudioLines, Music } from 'lucide-react'
import { AudioNode } from './audio-node'

/** AudioNode 示例（/playbook 展示单元）。 */
export function AudioNodeDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      <AudioNode title="Audio 配音/字幕" icon={AudioLines} status="running" />
      <AudioNode title="全局配乐 Music" icon={Music} nodeType="score" status="stale" />
    </div>
  )
}
