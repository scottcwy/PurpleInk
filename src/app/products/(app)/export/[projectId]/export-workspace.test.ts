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

describe('Export workspace composition', () => {
  it('opens export settings from a TopBar toggle instead of a permanent side panel', () => {
    expect(workspace).toContain('Popover')
    expect(workspace).toMatch(/>\s*导出\s*</)
    expect(workspace).not.toContain('导出 MP4')
    expect(workspace).toContain('variant="tinted"')
    expect(workspace).toContain('ExportSettings')
    expect(workspace).toContain('ExportQa')
    expect(workspace).not.toContain('ExportReview')
    expect(workspace).not.toContain('DrawerOverlay')
    expect(workspace).not.toContain('useResizablePanel')
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

  it('keeps start-export CTA on the tinted light-mode family', () => {
    expect(settings).toContain('variant="tinted"')
    expect(settings).toContain('开始导出')
    expect(settings).toContain('ProgressBar')
  })
})
