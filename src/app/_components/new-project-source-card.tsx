'use client'

import { Combine, FileCode, Upload } from 'lucide-react'
import { buttonClassName } from '@/components/ui/button'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

const SCRIPT_PLACEHOLDER =
  '粘贴完整文字稿。系统会保留源稿版本，并沿用现有分镜、配音与渲染工作流。'

const SOURCE_PRESENTATION = {
  script: {
    title: '文稿视频',
    meta: '源稿 → 分镜 → 配音',
    icon: FileCode,
  },
  audio: {
    title: '录音转视频',
    meta: '转写 → 原声时间轴 → 分镜',
    icon: Upload,
  },
  website: {
    title: '网站介绍视频',
    meta: '采集 → 脚本 → 成片',
    icon: Combine,
  },
} as const

export interface NewProjectSourceCardProps {
  kind: ProjectWorkflowKind
  script: string
  audioFile?: File
  websiteUrl: string
  onScriptChange: (value: string) => void
  onAudioFileChange: (file?: File) => void
  onWebsiteUrlChange: (value: string) => void
}

export function NewProjectSourceCard({
  kind,
  script,
  audioFile,
  websiteUrl,
  onScriptChange,
  onAudioFileChange,
  onWebsiteUrlChange,
}: NewProjectSourceCardProps) {
  const presentation = SOURCE_PRESENTATION[kind]
  return (
    <CollapsibleCard
      key={kind}
      title={presentation.title}
      meta={presentation.meta}
      icon={presentation.icon}
      defaultOpen
      bodyClassName="p-4"
    >
      {kind === 'script' && (
        <TextArea
          label="源文本"
          placeholder={SCRIPT_PLACEHOLDER}
          value={script}
          onChange={(event) => onScriptChange(event.target.value)}
          className="w-full [&>textarea]:min-h-[190px]"
        />
      )}
      {kind === 'audio' && (
        <div className="flex flex-col gap-3">
          <input
            id="new-project-audio"
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav,audio/wave"
            className="sr-only"
            onChange={(event) => onAudioFileChange(event.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="new-project-audio"
              className={buttonClassName({ variant: 'gray', size: 'md' })}
            >
              <Upload className="size-4" />
              选择 MP3 / WAV
            </label>
            <span className="min-w-0 text-[13px] text-ds-text-muted">
              {audioFile
                ? `${audioFile.name} · ${formatFileSize(audioFile.size)}`
                : '尚未选择录音'}
            </span>
          </div>
          <p className="text-xs leading-5 text-ds-text-muted">
            最大 100 MB、30 分钟。系统先转写，再按原录音切分时间与分镜；不会重复配音。
          </p>
        </div>
      )}
      {kind === 'website' && (
        <div className="flex flex-col gap-3">
          <TextField
            label="公开网站 URL"
            type="url"
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.com/product"
            value={websiteUrl}
            onChange={(event) => onWebsiteUrlChange(event.target.value)}
            className="w-full"
          />
          <p className="text-xs leading-5 text-ds-text-muted">
            默认生成 24 秒标准质量视频。Playwright 采集与成熟生视频引擎会作为项目工作流执行。
          </p>
        </div>
      )}
    </CollapsibleCard>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
