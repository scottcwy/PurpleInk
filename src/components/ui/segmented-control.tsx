import { cn } from '@/lib/utils'
import { ControlPressButton } from '@/components/ui/control-motion'

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
 * 激活项带微投影浮起；选项统一 focus ring。
 */
export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-[10px] bg-ds-surface-muted p-1 text-ds-text',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <ControlPressButton
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring',
              active
                ? 'bg-ds-surface text-ds-text shadow-[0_1px_2px_#10183a1a]'
                : 'text-ds-text-muted hover:text-ds-text',
            )}
          >
            {option.label}
          </ControlPressButton>
        )
      })}
    </div>
  )
}
