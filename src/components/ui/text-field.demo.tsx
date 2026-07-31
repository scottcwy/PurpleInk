import { TextField } from './text-field'

export function TextFieldDemo() {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="项目名称"
        placeholder="例如：RAG 十分钟入门"
      />
      <TextField
        label="API Key（ghost 变体）"
        variant="ghost"
        placeholder="输入 API Key"
      />
      <TextField
        label="邮箱（hint）"
        placeholder="you@example.com"
        hint="用于接收验证码与渲染完成通知"
      />
      <TextField
        label="邮箱（error）"
        defaultValue="not-an-email"
        error="邮箱格式不正确"
      />
    </div>
  )
}
