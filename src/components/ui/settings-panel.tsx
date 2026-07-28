'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { CollapsibleCard } from './collapsible-card'

export interface SettingsPanelProps {
  id?: string
  title: string
  description?: string
  icon?: LucideIcon
  summary?: ReactNode
  defaultOpen?: boolean
  /** 受控展开态；提供时组件不自管理开合。 */
  open?: boolean
  /** 展开态变化回调。 */
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  className?: string
}

/**
 * 长设置页的折叠面板（Playbook SSOT）。
 * 只负责标题、说明与折叠语义；具体字段继续由 SettingsGroup / SettingsRow 组合。
 */
export function SettingsPanel({
  id,
  title,
  description,
  icon,
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  className,
}: SettingsPanelProps) {
  return (
    <section id={id} className="min-w-0 scroll-mt-5" data-glow>
      <CollapsibleCard
        title={
          <span className="block min-w-0">
            <span className="block">{title}</span>
            {description && (
              <span className="mt-0.5 block text-[13px] font-normal leading-5 text-ds-text-muted">
                {description}
              </span>
            )}
          </span>
        }
        icon={icon}
        meta={summary}
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={onOpenChange}
        className={className}
        bodyClassName="p-0"
      >
        <div className="flex min-w-0 flex-col">{children}</div>
      </CollapsibleCard>
    </section>
  )
}
