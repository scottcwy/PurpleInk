import { Card, CardBody, CardTitle } from './card'

/** Card 组件示例（/playbook 展示单元）。 */
export function CardDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardTitle>分镜节点</CardTitle>
        <CardBody>每个分镜对应一个可独立渲染的节点。</CardBody>
      </Card>
      <Card>
        <CardTitle>确定性渲染</CardTitle>
        <CardBody>同一帧永远产出同一画面。</CardBody>
      </Card>
    </div>
  )
}
