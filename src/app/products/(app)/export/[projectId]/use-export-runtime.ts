'use client'

import { useEffect, useState } from 'react'
import {
  type ResolutionPreset,
  type SubtitleDeliveryMode,
} from '@/features/canvas/export-settings'
import {
  loadExportReadiness,
  startProjectExport,
  updateExportResolution,
  updateExportSubtitles,
} from './export-api'
import { type ExportReadiness } from './export-readiness-contract'

export function useExportRuntime(projectId: string) {
  const [readiness, setReadiness] = useState<ExportReadiness>()
  const [outputUrl, setOutputUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void refreshReadiness()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '导出状态读取失败')
      })
    // refreshReadiness 只依赖当前 projectId；项目切换时重新读取服务端真值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function refreshReadiness(): Promise<ExportReadiness> {
    const nextReadiness = await loadExportReadiness(projectId)
    setReadiness(nextReadiness)
    setOutputUrl(nextReadiness.artifactUrl)
    return nextReadiness
  }

  async function exportVideo(): Promise<string | undefined> {
    return runExport({})
  }

  /** 降级导出：缺失分镜以占位顶替（用户显式确认后调用）。 */
  async function exportDegraded(): Promise<string | undefined> {
    if (!readiness?.confirmationFingerprint) {
      setError('降级确认已失效，请刷新导出状态后重试')
      return undefined
    }
    return runExport({
      degraded: true,
      confirmationFingerprint: readiness.confirmationFingerprint,
    })
  }

  async function runExport(
    options: { degraded?: boolean; confirmationFingerprint?: string }
  ): Promise<string | undefined> {
    setExporting(true)
    setError(undefined)
    try {
      const url = await startProjectExport(projectId, fetch, undefined, options)
      setOutputUrl(url)
      void refreshReadiness().catch(() => {})
      return url
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '终片导出失败')
      return undefined
    } finally {
      setExporting(false)
    }
  }

  async function updateResolution(preset: ResolutionPreset) {
    setReadiness((prev) => (prev ? { ...prev, resolutionPreset: preset } : prev))
    try {
      await updateExportResolution(projectId, preset)
      await refreshReadiness()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出设置更新失败')
      void refreshReadiness().catch(() => {})
    }
  }

  async function updateSubtitles(subtitles: SubtitleDeliveryMode) {
    setReadiness((prev) => (prev ? { ...prev, subtitles } : prev))
    try {
      await updateExportSubtitles(projectId, subtitles)
      await refreshReadiness()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '字幕交付设置更新失败')
      void refreshReadiness().catch(() => {})
    }
  }

  return {
    readiness,
    outputUrl,
    error,
    exporting,
    exportVideo,
    exportDegraded,
    updateResolution,
    updateSubtitles,
  }
}
