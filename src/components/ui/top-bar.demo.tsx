import { Download, Play, RefreshCw } from 'lucide-react'
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
          <Button variant="gray" size="sm" icon={Play}>
            全部渲染
          </Button>
          <Button variant="destructive" size="sm" icon={RefreshCw}>
            重渲此镜
          </Button>
          <Button size="sm" icon={Download}>
            导出
          </Button>
        </>
      }
    />
  )
}
