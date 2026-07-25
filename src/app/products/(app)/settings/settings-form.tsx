'use client'

import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { productExportHref } from '@/features/navigation/products-routes'
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
    <main className="min-h-0 flex-1 overflow-y-auto text-ds-text">
      <TopBar title="设置" meta="Provider Registry 与运行默认值" />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 py-7 sm:px-8 xl:px-[120px]">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold">Provider 与默认值</h1>
          <p className="text-sm text-ds-text-muted">
            Provider Registry 会先验证凭据，再替换已保存的 Secret。
          </p>
        </header>
        <div className="grid items-start gap-[18px] lg:grid-cols-2">
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
                href={productExportHref(projectId)}
                className="text-[13px] text-ds-blue underline-offset-2 hover:underline"
              >
                按项目在导出页配置
              </Link>
            ) : (
              <span className="text-[13px] text-ds-text-muted">按项目在导出页配置</span>
            )}
          </SettingsRow>
          <SettingsSeparator />
          <SettingsRow label="崩溃续渲">
            {/* Demo 占位：执行状态已落 Postgres，但暂无崩溃后自动重新入队的恢复逻辑，
                见 docs/issues/issue-10-*.md；不得用恒 checked 的 Toggle 伪装为已实现。 */}
            <span className="text-[13px] text-ds-text-muted">尚未实现（Demo 占位）</span>
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
            <span className="flex items-center gap-2 text-[13px] text-ds-text-muted">
              <ShieldCheck className="size-3.5 text-ds-green" />
              本地存储 · 模型数据直连所选服务
            </span>
          </SettingsRow>
        </SettingsSection>
        </div>
        <p className="text-center text-xs text-ds-text-muted">
          PurpleInk · 本地优先的 AIGC 视频创作引擎
        </p>
      </div>
    </main>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs text-ds-text-muted">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}
