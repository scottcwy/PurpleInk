import { FileCode } from 'lucide-react'
import { ArtifactChip } from './artifact-chip'

/** ArtifactChip 示例（/playbook 展示单元）。 */
export function ArtifactChipDemo() {
  return (
    <div className="flex gap-2">
      <ArtifactChip icon={FileCode} filename="shot-plan.json" />
      <ArtifactChip icon={FileCode} filename="shot-plan.json" href="#" />
    </div>
  )
}
