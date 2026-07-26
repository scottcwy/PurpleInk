'use client'

import { HumanCheckField } from './human-check-field'

const DEMO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="132" height="44" viewBox="0 0 132 44"',
  ' role="img" aria-label="请计算：17 + 8">',
  '<rect width="132" height="44" rx="6" fill="#e8ecfa"/>',
  '<path d="M6 33 L44 12 M52 34 L96 9 M104 32 L126 14" stroke="#68728f"',
  ' stroke-width="1" opacity="0.45" fill="none"/>',
  '<text x="66" y="29" text-anchor="middle" font-family="ui-monospace, monospace"',
  ' font-size="19" letter-spacing="2" fill="#171a2e">17 + 8</text>',
  '</svg>',
].join('')

export function HumanCheckFieldDemo() {
  return (
    <div className="flex w-[360px] max-w-full flex-col gap-4">
      <HumanCheckField
        label="人机验证"
        question="17 + 8"
        svg={DEMO_SVG}
        placeholder="答案"
        onRefresh={() => undefined}
      />
      <HumanCheckField
        label="人机验证（纯文本降级）"
        question="24 - 9"
        placeholder="答案"
        onRefresh={() => undefined}
      />
    </div>
  )
}
