import { Download, Play, Plus, RefreshCw } from 'lucide-react'
import { Button } from './button'

/** Button 四变体示例（与业务页语义一致，供 /playbook/ui 验收）。 */
export function ButtonDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button icon={Plus}>新建项目</Button>
      <Button size="sm" icon={Download}>
        导出
      </Button>
      <Button variant="tinted" icon={Play}>
        执行此阶段
      </Button>
      <Button variant="gray">取消</Button>
      <Button variant="destructive" icon={RefreshCw}>
        重渲此镜
      </Button>
    </div>
  )
}
