import type { SVGProps } from 'react'

/** 品牌标记（示例 SVG 图标，源自 Pencil 稿件；用 className 控制尺寸/颜色）。 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="4" width="20" height="16" rx="3" className="fill-gray-900" />
      <path d="M10 9l5 3-5 3V9z" className="fill-white" />
    </svg>
  )
}
