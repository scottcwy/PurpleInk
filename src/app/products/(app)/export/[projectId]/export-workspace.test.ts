import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-workspace.tsx',
  'utf8',
)
const settings = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-settings.tsx',
  'utf8',
)
const qa = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-qa.tsx',
  'utf8',
)
const api = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-api.ts',
  'utf8',
)

describe('Export workspace composition', () => {
  it('opens export settings from a TopBar toggle instead of a permanent side panel', () => {
    expect(workspace).toContain('Popover')
    expect(workspace).toMatch(/>\s*导出\s*</)
    expect(workspace).not.toContain('导出 MP4')
    expect(workspace).toContain('ExportSettings')
    expect(workspace).toContain('ExportQa')
    expect(workspace).not.toContain('ExportReview')
    expect(workspace).not.toContain('DrawerOverlay')
    expect(workspace).not.toContain('useResizablePanel')
    expect(workspace).not.toContain('variant="tinted"')
  })

  it('keeps Final QA as a full-width section under the pipeline timeline', () => {
    const previewIdx = workspace.indexOf('ExportPreview')
    const timelineIdx = workspace.indexOf('ExportTimeline')
    const qaIdx = workspace.indexOf('<ExportQa')
    expect(previewIdx).toBeGreaterThan(-1)
    expect(timelineIdx).toBeGreaterThan(previewIdx)
    expect(qaIdx).toBeGreaterThan(timelineIdx)
    expect(qa).toContain('Final QA · 抽帧审查')
  })

  it('auto-closes the settings popover after a successful export and surfaces the download near preview', () => {
    expect(workspace).toContain('handleExport')
    expect(workspace).toContain('setSettingsOpen(false)')
    expect(workspace).toContain('ArtifactChip')
    expect(workspace).toContain('final.mp4')
    expect(workspace).toContain('dismissible={!runtime.exporting}')
  })

  it('keeps start-export CTA on the theme-aware primary Button family', () => {
    expect(settings).toContain('开始导出')
    expect(settings).toContain('ProgressBar')
    expect(settings).not.toContain('variant="tinted"')
    expect(settings).not.toContain('variant="destructive"')
  })

  it('renders only readiness-backed media tracks and marks BGM/SFX as unwired', () => {
    expect(workspace).toContain('readiness={runtime.readiness}')
    expect(workspace).toContain('旁白就绪')
    expect(workspace).toContain('字幕就绪')
    expect(workspace).toContain('BGM（未接线）')
    expect(workspace).toContain('SFX（未接线）')
    expect(workspace).not.toContain("fullTrackClip('配乐'")
    expect(settings).toContain('硬字幕烧录')
    expect(settings).toContain('旧版静音成片')
    expect(settings).not.toContain('暂不支持（P1）')
  })

  it('shows lane-scoped media blockers with human-readable labels', () => {
    expect(qa).toContain('blockingIssueLabel')
    expect(api).toContain('缺旁白')
    expect(api).toContain('缺字幕')
    expect(api).toContain('产物无效')
  })
})
