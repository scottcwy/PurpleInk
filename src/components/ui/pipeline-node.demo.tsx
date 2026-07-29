import { FileInput, ShieldCheck, Sparkles } from 'lucide-react'
import { PipelineNode } from './pipeline-node'

export function PipelineNodeDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      <PipelineNode
        title="脚本导入"
        meta="script-import"
        nodeType="script-import"
        status="idle"
        icon={FileInput}
      />
      <PipelineNode
        title="代码生成"
        meta="shot-codegen"
        nodeType="shot-codegen"
        status="running"
        artifact="shot-source.json"
        icon={Sparkles}
      />
      <PipelineNode
        title="验收"
        meta="shot-qa"
        nodeType="shot-qa"
        status="failed"
        icon={ShieldCheck}
      />
      <PipelineNode
        title="语义拆分"
        meta="shot-split · selected"
        nodeType="shot-split"
        status="success"
        selected
        icon={Sparkles}
      />
    </div>
  )
}
