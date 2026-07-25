'use client'

import { useEffect, useState } from 'react'
import { type ResolutionPreset } from '@/features/canvas/export-settings'
import {
  loadExportReadiness,
  startProjectExport,
  updateExportResolution,
  type ExportReadiness,
} from './export-api'

export function useExportRuntime(projectId: string) {
  const [readiness, setReadiness] = useState<ExportReadiness>()
  const [outputUrl, setOutputUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void loadExportReadiness(projectId)
      .then((nextReadiness) => {
        setReadiness(nextReadiness)
        setOutputUrl(nextReadiness.artifactUrl)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '导出状态读取失败')
      })
  }, [projectId])

  async function exportVideo(): Promise<string | undefined> {
    setExporting(true)
    setError(undefined)
    try {
      const url = await startProjectExport(projectId)
      setOutputUrl(url)
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出设置更新失败')
      void loadExportReadiness(projectId).then(setReadiness).catch(() => {})
    }
  }

  return { readiness, outputUrl, error, exporting, exportVideo, updateResolution }
}
