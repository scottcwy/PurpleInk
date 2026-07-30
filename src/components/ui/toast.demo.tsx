'use client'

import { Button } from './button'
import { Toast, toast } from './toast'

/** Toast 四变体示例（/playbook 展示单元）。 */
export function ToastDemo() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          variant="gray"
          onClick={() => toast.show('success', '已加入通知队列', '5 秒后自动消失')}
        >
          发送全局 Toast
        </Button>
      </div>
      <Toast
        title="AI 正在生成分镜描述"
        body="分镜 02 的视觉合同编写中"
        onClose={() => {}}
      />
      <Toast
        variant="success"
        title="渲染完成"
        body="分镜 03 已输出 240 帧（00:08）"
        onClose={() => {}}
      />
      <Toast
        variant="warning"
        title="QA 警告"
        body="镜头 03 主视觉偏小，建议复核"
        onClose={() => {}}
      />
      <Toast
        variant="error"
        title="StepFun Key 校验失败"
        body="请检查 Key 是否正确"
        onClose={() => {}}
      />
    </div>
  )
}
