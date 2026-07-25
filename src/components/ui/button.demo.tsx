import { Plus, RefreshCw, Play } from 'lucide-react'
import { Button } from './button'

/** Button 四变体示例。 */
export function ButtonDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button icon={Plus}>新建项目</Button>
      <Button variant="tinted" icon={RefreshCw}>重渲此镜</Button>
      <Button variant="gray" icon={Play}>取消</Button>
      <Button variant="destructive">删除</Button>
    </div>
  )
}
