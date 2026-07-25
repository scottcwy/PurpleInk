import { PipelineNode } from './pipeline-node'

export function PipelineNodeDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      <PipelineNode
        title="生成镜头"
        meta="cvc.shot.generate"
        status="running"
        artifact="shot-source.json"
      />
      <PipelineNode title="视觉 QA" meta="vision-qa" status="unwired" />
    </div>
  )
}
