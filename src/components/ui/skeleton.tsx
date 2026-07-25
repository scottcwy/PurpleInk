import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export interface SkeletonProps {
  className?: string
  style?: CSSProperties
  /** 圆形占位（头像 / 图标位）。默认为 rounded-sm 方块。 */
  circle?: boolean
}

/**
 * 骨架占位（SSOT）。
 * 真实懒加载 / 异步等待时用它撑出内容轮廓，横向微光提示“加载中”；
 * 系统开启“减弱动态效果”时由 globals.css 自动降级为静态。
 * 纯展示组件（无 'use client'），可直接用于服务端 loading.tsx。
 */
export function Skeleton({ className, style, circle }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-[length:200%_100%] bg-[linear-gradient(90deg,var(--color-fill)_25%,var(--color-fill-strong)_50%,var(--color-fill)_75%)]',
        circle ? 'rounded-full' : 'rounded-sm',
        className,
      )}
      style={style}
    />
  )
}
