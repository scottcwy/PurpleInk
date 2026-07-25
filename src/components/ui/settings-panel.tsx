'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { CollapsibleCard } from './collapsible-card'
import { SettingsGroup } from './settings-group'

export interface SettingsPanelProps {
  id?: string
  title: string
  description?: string
  icon?: LucideIcon
  summary?: ReactNode
  defaultOpen?: boolean
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
  defaultOpen = true,
  children,
  className,
}: SettingsPanelProps) {
  return (
    <section id={id} className="min-w-0 scroll-mt-5">
      <CollapsibleCard
        title={
          <span className="block min-w-0">
            <span className="block">{title}</span>
            {description && (
              <span className="mt-0.5 block text-xs font-normal leading-5 text-ds-text-muted">
                {description}
              </span>
            )}
          </span>
        }
        icon={icon}
        meta={summary}
        defaultOpen={defaultOpen}
        className={className}
        bodyClassName="p-0"
      >
        <SettingsGroup className="rounded-none border-0 bg-transparent">
          {children}
        </SettingsGroup>
      </CollapsibleCard>
    </section>
  )
}
