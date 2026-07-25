import { FileInput, ShieldCheck, Sparkles } from 'lucide-react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import { StageNode } from './stage-node'

/** StageNode 示例（/playbook 展示单元）。 */
export function StageNodeDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      <StageNode
        nodeType="script-import"
        name="文稿提交 Ingest"
        icon={FileInput}
        status="success"
        chips={
          <>
            <ArtifactChip filename="script-units.json" />
            <ArtifactChip filename="master-plan.md" />
          </>
        }
      />
      <StageNode
        nodeType="shot-split"
        name="语义拆分 Split"
        icon={Sparkles}
        status="running"
      />
      <StageNode
        nodeType="shot-qa"
        name="抽帧验收 QA"
        icon={ShieldCheck}
        status="pending"
      />
    </div>
  )
}
