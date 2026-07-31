'use client'

import { FileCode, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { cn } from '@/lib/utils'
import { NO_CODE } from './use-shot-runtime'

export function ShotCode({
  sourceCode,
  codeLoading,
  codeError,
  rendering,
  onRender,
}: {
  sourceCode: string
  codeLoading: boolean
  codeError: boolean
  rendering: boolean
  onRender: () => void
}) {
  const hasCode = sourceCode !== NO_CODE
  const sync = codeSyncLabel({ rendering, codeLoading, codeError, hasCode })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <FileCode className="size-4 text-ds-blue" />分镜画布代码
        </span>
        <span className={cn('text-[11px]', sync.tone)}>{sync.label}</span>
      </div>
      {codeLoading ? (
        <div className="min-h-0 flex-1 space-y-2 rounded-md bg-bg-secondary p-3">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-3" style={{ width: `${92 - index * 9}%` }} />
          ))}
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-ds-surface-muted p-3 text-[11px] leading-relaxed text-ds-text-muted">
          {sourceCode}
        </pre>
      )}
      <Button
        variant={hasCode ? 'destructive' : 'tinted'}
        icon={RefreshCw}
        onClick={onRender}
        disabled={rendering}
      >
        {hasCode ? '重渲此镜' : '生成分镜代码'}
      </Button>
    </div>
  )
}

function codeSyncLabel({
  rendering,
  codeLoading,
  codeError,
  hasCode,
}: {
  rendering: boolean
  codeLoading: boolean
  codeError: boolean
  hasCode: boolean
}): { label: string; tone: string } {
  if (rendering) return { label: '渲染中', tone: 'text-ds-text-muted' }
  if (codeLoading) return { label: '加载中', tone: 'text-ds-text-muted' }
  if (codeError) return { label: '读取失败', tone: 'text-ds-red' }
  if (hasCode) return { label: '已同步', tone: 'text-ds-green' }
  return { label: '待生成', tone: 'text-ds-text-muted' }
}

export function ShotContract({
  laneKey,
  sourceText,
  compositionMode,
  resolution,
  deterministic,
}: {
  laneKey: string
  sourceText: string
  compositionMode?: string
  resolution?: { width: number; height: number }
  deterministic: boolean
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <h2 className="text-[13px] font-semibold text-ds-text-muted">分镜合同</h2>
      <SettingsGroup>
        <SettingsRow label="分镜编号" value={laneKey} />
        <SettingsSeparator />
        <SettingsRow label="构图模式" value={compositionMode ?? '待生成'} />
        <SettingsSeparator />
        <SettingsRow
          label="分辨率"
          value={resolution ? `${resolution.width}×${resolution.height}` : '待生成'}
        />
      </SettingsGroup>
      <h2 className="text-[13px] font-semibold text-ds-text-muted">字幕</h2>
      <div className="rounded-md bg-ds-surface-muted p-2">
        <p className="mb-1 text-xs font-mono text-ds-blue">00:00–结束</p>
        <p className="text-[13px]">{sourceText}</p>
      </div>
      <p className="flex items-center gap-2 text-xs text-ds-text-muted">
        <ShieldCheck
          className={cn('size-3.5', deterministic ? 'text-ds-green' : 'text-ds-text-muted')}
        />
        {deterministic ? '无 rAF / 无墙钟 · 通过' : '无 rAF / 无墙钟 · 未验证'}
      </p>
    </aside>
  )
}
