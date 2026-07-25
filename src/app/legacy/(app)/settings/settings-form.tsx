'use client'

import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ModelServiceSettings } from './model-service-settings'
import { ThemeControl } from './theme-control'

interface SettingsResponse {
  renderConcurrency?: number
}

export function SettingsForm({
  projectId,
  rendererNodeId,
}: {
  projectId?: string
  rendererNodeId?: string
}) {
  const [renderConcurrency, setRenderConcurrency] = useState<number>()

  usePublishNavContext({ projectId, rendererNodeId })

  useEffect(() => {
    void fetch('/api/settings')
      .then((response) => response.json() as Promise<SettingsResponse>)
      .then((body) => {
        setRenderConcurrency(body.renderConcurrency)
      })
      .catch(() => undefined)
  }, [])

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-6 overflow-y-auto px-4 py-10">
        <h1 className="text-[28px] font-bold">设置</h1>
        <ModelServiceSettings />
        <SettingsSection title="渲染">
          <SettingsRow
            label="渲染并发数"
            value={renderConcurrency ? `${renderConcurrency}（CPU 核数，暂不可配置）` : undefined}
          />
          <SettingsSeparator />
          <SettingsRow label="导出分辨率">
            {projectId ? (
              <Link
                href={`/legacy/canvas/export?projectId=${encodeURIComponent(projectId)}`}
                className="text-[13px] text-accent underline-offset-2 hover:underline"
              >
                按项目在导出页配置
              </Link>
            ) : (
              <span className="text-[13px] text-label-tertiary">按项目在导出页配置</span>
            )}
          </SettingsRow>
          <SettingsSeparator />
          <SettingsRow label="崩溃续渲">
            {/* Demo 占位：执行状态已落 Postgres，但暂无崩溃后自动重新入队的恢复逻辑，
                见 docs/issues/issue-10-*.md；不得用恒 checked 的 Toggle 伪装为已实现。 */}
            <span className="text-[13px] text-label-tertiary">尚未实现（Demo 占位）</span>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="外观">
          <SettingsRow label="主题">
            <ThemeControl />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="关于">
          <SettingsRow label="版本" value="0.1.0 (Demo)" />
          <SettingsSeparator />
          <SettingsRow label="本地模式">
            <span className="flex items-center gap-2 text-[13px] text-label-secondary">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              本地存储 · 模型数据直连所选服务
            </span>
          </SettingsRow>
        </SettingsSection>
        <p className="text-center text-xs text-label-tertiary">CodeVideoCanvas · 本地优先的 AIGC 视频创作引擎</p>
    </main>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs text-label-tertiary">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}
