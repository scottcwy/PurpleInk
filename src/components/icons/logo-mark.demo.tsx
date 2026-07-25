import { LogoMark } from './logo-mark'

/** LogoMark 图标示例（/playbook 展示单元）。 */
export function LogoMarkDemo() {
  return (
    <div className="flex items-center gap-4">
      <LogoMark className="h-6 w-6" />
      <LogoMark className="h-10 w-10" />
      <LogoMark className="h-16 w-16" />
    </div>
  )
}
