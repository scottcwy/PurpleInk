import { cn } from '@/lib/utils'

export function PurpleInkLogo({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex h-10 items-center gap-2.5 text-ds-text', className)}
      aria-label="PurpleInk"
    >
      <svg
        aria-hidden
        className="size-10 shrink-0"
        viewBox="0 0 40 40"
        fill="none"
      >
        <rect
          x="2.5"
          y="2.5"
          width="34"
          height="34"
          rx="8.5"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          d="M10 31V9h10.4c6.3 0 9.6 3.1 9.6 8.2 0 5.2-3.3 8.2-9.6 8.2H16V31h-6Zm6-16.7v5.9h4c2.8 0 4.1-.9 4.1-3 0-2-1.3-2.9-4.1-2.9h-4Z"
          fill="currentColor"
        />
        <circle cx="33" cy="8" r="4" fill="var(--ds-magenta)" />
      </svg>
      {!compact ? (
        <span className="text-[21px] font-bold tracking-[-0.5px]">PurpleInk</span>
      ) : null}
    </span>
  )
}
