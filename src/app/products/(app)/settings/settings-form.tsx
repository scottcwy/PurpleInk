'use client'

import {
  Bot,
  Cpu,
  Info,
  Palette,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { SectionNav } from '@/components/ui/section-nav'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ModelServicePanels } from './model-service-panels'
import { useModelSettingsController } from './model-service-settings'
import { RuntimeConcurrencyPanel } from './runtime-concurrency-panel'
import { ThemeControl } from './theme-control'

const SETTINGS_NAV = [
  { id: 'providers', label: '模型服务' },
  { id: 'routing', label: '节点路由' },
  { id: 'runtime', label: '运行与导出' },
  { id: 'appearance', label: '外观' },
  { id: 'about', label: '关于' },
] as const

export function SettingsForm({
  projectId,
  rendererNodeId,
}: {
  projectId?: string
  rendererNodeId?: string
}) {
  usePublishNavContext({ projectId, rendererNodeId })
  const controller = useModelSettingsController()
  const scrollRef = useRef<HTMLElement>(null)
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({})
  const handlePanelOpenChange = useCallback((id: string, open: boolean) => {
    setOpenPanels((prev) => ({ ...prev, [id]: open }))
  }, [])

  return (
    <main
      ref={scrollRef}
      data-testid="settings-scroll-region"
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain text-ds-text"
    >
      <TopBar title="设置" meta="Provider Registry 与运行默认值" />
      <div className="mx-auto grid w-full max-w-[1280px] lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          <div className="mx-auto flex min-w-0 w-full max-w-[940px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            <header className="mb-6">
              <div className="flex items-center gap-2.5">
                <h2 className="text-2xl font-bold">Provider 与默认值</h2>
                <StatusPill variant="rendered" icon={ShieldCheck} label="本地优先" />
              </div>
              <p className="mt-1.5 text-sm text-ds-text-muted">
                按职责展开设置组；未展开的配置不会丢失，也不会触发保存。Secret 仅在验证成功后更新，不会暴露到客户端。
              </p>
            </header>

            {controller.ready ? (
              <ModelServicePanels
                controller={controller}
                openPanels={openPanels}
                onPanelOpenChange={handlePanelOpenChange}
              />
            ) : (
              <ModelSettingsSkeleton />
            )}

            {controller.ready ? (
              <RuntimeConcurrencyPanel
                controller={controller}
                openPanels={openPanels}
                onPanelOpenChange={handlePanelOpenChange}
              />
            ) : (
              <RuntimeSkeleton />
            )}

            <SettingsPanel
              id="appearance"
              title="外观"
              description="界面主题仅保存到当前浏览器"
              icon={Palette}
              summary="跟随偏好"
              open={openPanels['appearance'] ?? false}
              onOpenChange={(open) => handlePanelOpenChange('appearance', open)}
            >
              <SettingsRow label="主题">
                <ThemeControl />
              </SettingsRow>
            </SettingsPanel>

            <SettingsPanel
              id="about"
              title="关于 PurpleInk"
              description="本地运行版本与数据边界"
              icon={Info}
              summary="0.1.0"
              defaultOpen={false}
              open={openPanels['about'] ?? false}
              onOpenChange={(open) => handlePanelOpenChange('about', open)}
            >
              <SettingsRow label="版本" value="0.1.0 (Demo)" />
              <SettingsRow label="本地模式">
                <span className="flex items-center gap-2 text-[13px] text-ds-text-muted">
                  <ShieldCheck className="size-3.5 text-ds-green" />
                  本地存储 · 模型数据直连所选服务
                </span>
              </SettingsRow>
            </SettingsPanel>

            <p className="py-2 text-center text-xs text-ds-text-muted">
              PurpleInk · 本地优先的 AIGC 视频创作引擎
            </p>
          </div>
        </div>

        <div className="hidden lg:sticky lg:top-0 lg:flex lg:max-h-screen lg:flex-col lg:self-start lg:px-4 lg:py-6">
          <SectionNav
            title="本页导航"
            ariaLabel="设置分类"
            items={SETTINGS_NAV}
            scrollContainerRef={scrollRef}
            onNavigate={(id) => setOpenPanels((prev) => ({ ...prev, [id]: true }))}
          />
        </div>
      </div>
    </main>
  )
}

function ModelSettingsSkeleton() {
  return (
    <SettingsPanel
      id="providers"
      title="模型服务"
      description="正在读取真实 Provider Registry"
      icon={Bot}
    >
      <SettingsRow label="正在读取真实配置">
        <Skeleton className="h-9 w-[260px] rounded-md" />
      </SettingsRow>
    </SettingsPanel>
  )
}

function RuntimeSkeleton() {
  return (
    <SettingsPanel
      id="runtime"
      title="运行与导出"
      description="正在读取队列配额"
      icon={Cpu}
    >
      <SettingsRow label="正在读取真实配额">
        <Skeleton className="h-9 w-[260px] rounded-md" />
      </SettingsRow>
    </SettingsPanel>
  )
}
