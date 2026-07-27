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
    </div>
  )
}
