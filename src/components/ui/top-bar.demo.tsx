import { Play, Download } from 'lucide-react'
import { Button } from './button'
import { TopBar } from './top-bar'

/** TopBar 示例（/playbook 展示单元）。 */
export function TopBarDemo() {
  return (
    <TopBar
      title="RAG 十分钟入门"
      meta="8 节点 · 已自动保存"
      actions={
        <>
          <Button variant="gray" icon={Play} className="text-[13px]">
            全部渲染
          </Button>
          <Button icon={Download} className="text-[13px]">
            导出 MP4
          </Button>
        </>
      }
    />
  )
}
