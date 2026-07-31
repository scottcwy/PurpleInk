import { Download, Film, ShieldAlert } from 'lucide-react'
import { ArtifactChip } from '@/components/ui/artifact-chip'
import type {
  ProjectExecutionSnapshot,
  WebsiteDeliverySnapshot,
} from '@/features/projects'
import {
  websiteDeliveryForDownload,
  websiteDownloadHref,
} from './website-export-model'

export function WebsiteDeliveryPreview({
  delivery,
  execution,
  projectTitle,
}: {
  delivery: ReturnType<typeof websiteDeliveryForDownload>
  execution: ProjectExecutionSnapshot
  projectTitle: string
}) {
  const evidence = execution.delivery
  const verification = evidence?.verification
  const exportStage = execution.stages.find((stage) => stage.phase === 'export')
  return (
    <section className="rounded-xl border border-ds-border bg-ds-surface p-4">
      <div className="aspect-video overflow-hidden rounded-lg bg-black">
        {delivery?.downloadUrl ? (
          <video
            src={delivery.downloadUrl}
            controls
            preload="metadata"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-text-inverse">
            {execution.state === 'blocked'
              ? <ShieldAlert className="size-9 text-status-warning" />
              : <Film className="size-9 opacity-70" />}
            <p className="text-sm font-medium">
              {previewMessage(execution.state)}
            </p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{projectTitle} · 成片</h2>
          <p className="mt-1 text-[11px] text-ds-text-muted">
            {exportStage?.durationSec != null
              ? `时长 ${formatDuration(exportStage.durationSec)}`
              : '时长将在真实成片登记后显示'}
            {evidence ? ` · ${formatBytes(evidence.sizeBytes)}` : ''}
          </p>
        </div>
        {delivery?.downloadUrl && (
          <ArtifactChip
            icon={Download}
            filename={`website-video-v${delivery.version}.mp4`}
            href={websiteDownloadHref(delivery.downloadUrl)}
            download
          />
        )}
      </div>
      <dl className="mt-4 grid gap-2 rounded-lg bg-ds-surface-muted p-3 text-xs sm:grid-cols-2">
        <Fact
          label="容器校验"
          value={verificationLabel(verification?.checkPassed)}
        />
        <Fact
          label="Golden 校验"
          value={verificationLabel(verification?.goldenVerified)}
        />
        <Fact
          label="Artifact 状态"
          value={evidence
            ? `${evidence.lifecycle} · v${evidence.version}`
            : '尚未登记'}
        />
        <Fact
          label="代码音效"
          value={websiteSoundEffectsLabel(evidence?.soundEffects)}
        />
        <Fact
          label="内容哈希"
          value={evidence?.contentHash ?? '尚未登记'}
          mono
        />
      </dl>
    </section>
  )
}

function websiteSoundEffectsLabel(
  soundEffects: WebsiteDeliverySnapshot['soundEffects']
): string {
  if (!soundEffects) return '尚无可验证清单'
  if (soundEffects.status === 'applied') {
    return `已混入 · ${soundEffects.cueCount} 个`
  }
  if (soundEffects.status === 'omitted-off') return '未包含音效'
  if (soundEffects.status === 'omitted-no-cues') return '无可用触发点'
  if (soundEffects.status === 'omitted-error') return '混音失败 · 已安全省略'
  return '当前素材不支持 · 已省略'
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-text-muted">{label}</dt>
      <dd
        className={mono
          ? 'mt-1 break-all font-mono text-[10px] text-ds-text'
          : 'mt-1 text-ds-text'}
      >
        {value}
      </dd>
    </div>
  )
}

function previewMessage(state: ProjectExecutionSnapshot['state']): string {
  if (state === 'blocked') return '成片已生成，质量验收未通过'
  if (state === 'failed') return '执行失败，重新启动后将在这里显示成片'
  if (state === 'cancelled') return '项目已取消，可以重新启动'
  if (state === 'idle') return '启动后将在这里显示真实成片'
  return '成片正在生成，通过验收后自动出现在这里'
}

function verificationLabel(value: boolean | undefined): string {
  if (value === true) return '通过'
  if (value === false) return '未通过'
  return '尚未执行'
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
