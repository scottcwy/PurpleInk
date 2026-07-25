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
 * InspectorTabs Canonical（ds-surface-muted 轨道 + ds-surface 激活项）。
 */
export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-ds-surface-muted p-1 text-ds-text',
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
              'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-ds-surface text-ds-text'
                : 'text-ds-text-muted hover:text-ds-text',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
