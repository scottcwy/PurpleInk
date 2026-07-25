import { Film, Plus } from 'lucide-react'
import { Button } from './button'
import { EmptyState } from './empty-state'

/** EmptyState 示例（/playbook 展示单元）。 */
export function EmptyStateDemo() {
  return (
    <EmptyState
      icon={Film}
      title="还没有项目"
      description="粘贴一段文字稿，开始创作"
      action={
        <Button variant="tinted" icon={Plus}>
          新建项目
        </Button>
      }
    />
  )
}
