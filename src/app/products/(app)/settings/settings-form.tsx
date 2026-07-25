'use client'

import {
  Bot,
  Cpu,
  Info,
  Palette,
  Route,
  ShieldCheck,
} from 'lucide-react'
import { NavItem } from '@/components/ui/nav-item'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SettingsRow } from '@/components/ui/settings-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TopBar } from '@/components/ui/top-bar'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { ModelServicePanels } from './model-service-panels'
import { useModelSettingsController } from './model-service-settings'
import { RuntimeConcurrencyPanel } from './runtime-concurrency-panel'
import { ThemeControl } from './theme-control'

const SETTINGS_NAV = [
  { href: '#providers', label: '模型服务', icon: Bot },
  { href: '#routing', label: '节点路由', icon: Route },
  { href: '#runtime', label: '运行与导出', icon: Cpu },
  { href: '#appearance', label: '外观', icon: Palette },
  { href: '#about', label: '关于', icon: Info },
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

  return (
    <main
      data-testid="settings-scroll-region"
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain text-ds-text"
    >
      <TopBar title="设置" meta="Provider Registry 与运行默认值" />
      <div className="mx-auto grid w-full max-w-[1280px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          aria-label="设置分类"
          className="hidden border-r border-ds-border px-4 py-6 lg:sticky lg:top-0 lg:flex lg:max-h-screen lg:flex-col lg:self-start"
        >
          <div className="px-2">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-ds-text-muted uppercase">
              Settings
            </p>
            <h1 className="mt-2 text-xl font-bold">设置中心</h1>
            <p className="mt-1 text-xs leading-5 text-ds-text-muted">
              配置 Provider、Pipeline 路由与本地运行偏好。
            </p>
          </div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="设置面板目录">
            {SETTINGS_NAV.map(({ href, label, icon }) => (
              <NavItem
                key={href}
                href={href}
                icon={icon}
                className="h-9 rounded-lg hover:bg-ds-surface-muted"
              >
                {label}
              </NavItem>
            ))}
          </nav>
          <div className="mt-auto rounded-lg border border-ds-border bg-ds-surface-muted p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <ShieldCheck className="size-4 text-ds-green" />
              本地优先
            </div>
            <p className="mt-1 text-[11px] leading-4 text-ds-text-muted">
              Secret 仅在验证成功后更新，不会暴露到客户端。
            </p>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mx-auto flex min-w-0 w-full max-w-[940px] flex-col gap-3 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            <header className="mb-2">
              <h2 className="text-2xl font-bold">Provider 与默认值</h2>
              <p className="mt-1 text-sm text-ds-text-muted">
                按职责展开设置组；未展开的配置不会丢失，也不会触发保存。
              </p>
            </header>

            {controller.ready ? (
              <ModelServicePanels controller={controller} />
            ) : (
              <ModelSettingsSkeleton />
            )}

            {controller.ready ? (
              <RuntimeConcurrencyPanel controller={controller} />
            ) : (
              <RuntimeSkeleton />
            )}

            <SettingsPanel
              id="appearance"
              title="外观"
              description="界面主题仅保存到当前浏览器"
              icon={Palette}
              summary="跟随偏好"
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
