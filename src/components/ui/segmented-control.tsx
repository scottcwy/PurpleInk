import { cn } from '@/lib/utils'

export type SegmentedControlOption = {
  value: string
  label: string
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

/**
 * 分段控制器（fill 轨道 + surface-raised 激活项 + shadow-float）。
 */
export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md bg-fill p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-sm px-3.5 py-1 text-[13px] font-sc transition-colors',
              active
                ? 'bg-surface-raised font-semibold text-label shadow-float'
                : 'font-normal text-label-secondary hover:text-label',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
