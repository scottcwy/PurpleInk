import { Download } from 'lucide-react'
import { ExportNode } from './export-node'

/** ExportNode 示例（/playbook 展示单元）。 */
export function ExportNodeDemo() {
  return (
    <ExportNode
      title="Finalize 导出"
      fileLabel="成片 · MP4 1080p"
      icon={Download}
      status="success"
    />
  )
}
