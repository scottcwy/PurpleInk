'use client'

import { HoverPreview } from './hover-preview'

const LONG_SAMPLE = Array.from({ length: 40 }, (_, index) =>
  `${String(index + 1).padStart(2, '0')}  悬停预览示例行：小字正文，超出硬上限后在面板内滚动。`,
).join('\n')

/** HoverPreview 交互示例（/playbook 展示单元）。 */
export function HoverPreviewDemo() {
  return (
    <HoverPreview
      label="示例预览"
      trigger={
        <button
          type="button"
          className="rounded-md border border-ds-border bg-ds-surface-muted px-2 py-[5px] font-mono text-[11px] text-ds-text"
        >
          shot-plan.json
        </button>
      }
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ds-text">
        {LONG_SAMPLE}
      </pre>
    </HoverPreview>
  )
}
