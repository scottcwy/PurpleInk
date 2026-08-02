'use client'

import type { ReactNode } from 'react'

export type Stage = 'idle' | 'input' | 'creating' | 'error'
export type Quality = 'draft' | 'standard' | 'high'

export const QUALITY_OPTS: { value: Quality; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'standard', label: '标准' },
  { value: 'high', label: '高清' },
]

export const DURATION_OPTS = [15, 24, 40]

export const PILL_BASE =
  'focus-ring group bg-background text-foreground relative isolate inline-flex h-16 w-full max-w-md items-center overflow-hidden rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)]'

export function ActionCircle({
  children,
  active,
}: {
  children: ReactNode
  active?: boolean
}): ReactNode {
  return (
    <span
      className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{
        backgroundColor: active ? '#352e82' : 'var(--foreground)',
        color: active ? '#ffffff' : 'var(--background)',
      }}
    >
      {children}
    </span>
  )
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="focus-ring min-h-11 rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active
          ? '#352e82'
          : 'color-mix(in oklab, var(--foreground) 8%, transparent)',
        color: active ? '#ffffff' : 'var(--foreground)',
      }}
    >
      {children}
    </button>
  )
}

export function ComposerSettings({
  quality,
  duration,
  onQualityChange,
  onDurationChange,
}: {
  quality: Quality
  duration: number
  onQualityChange: (value: Quality) => void
  onDurationChange: (value: number) => void
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 pt-4">
      <div role="group" aria-label="视频质量" className="flex items-center gap-1.5">
        <span className="text-muted-foreground mr-0.5 text-xs">质量</span>
        {QUALITY_OPTS.map((option) => (
          <Chip
            key={option.value}
            active={quality === option.value}
            onClick={() => onQualityChange(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      <div role="group" aria-label="视频时长" className="flex items-center gap-1.5">
        <span className="text-muted-foreground mr-0.5 text-xs">时长</span>
        {DURATION_OPTS.map((seconds) => (
          <Chip
            key={seconds}
            active={duration === seconds}
            onClick={() => onDurationChange(seconds)}
          >
            {seconds}s
          </Chip>
        ))}
      </div>
    </div>
  )
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '请稍后重试'
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
    return '网络连接失败，请稍后重试'
  }
  return message.split('\n')[0] || '请稍后重试'
}

export function normalizedHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}
