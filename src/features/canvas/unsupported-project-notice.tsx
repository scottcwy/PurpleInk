import { ArchiveRestore } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function UnsupportedProjectNotice() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        icon={ArchiveRestore}
        title="旧版项目暂不可用"
        description="项目数据与历史产物已完整保留；当前版本仅支持 1920×1080 横屏工作流。"
      />
    </main>
  )
}
