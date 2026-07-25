import { ShotNode } from './shot-node'

/** ShotNode 示例（/playbook 展示单元）。 */
export function ShotNodeDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      <ShotNode
        title="分镜 01 代码生成"
        meta="HTML+GSAP · 配方 G12"
        duration="00:08"
        status="success"
      />
      <ShotNode
        title="分镜 02 详细脚本"
        meta="HTML+GSAP · 配方 G12"
        duration="00:10"
        status="running"
      />
    </div>
  )
}
