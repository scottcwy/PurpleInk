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
const deliveryCheck = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-delivery-check.tsx',
  'utf8',
)
const viewModel = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-view-model.ts',
  'utf8',
)
const contract = readFileSync(
  'src/app/products/(app)/export/[projectId]/export-readiness-contract.ts',
  'utf8',
)
const page = readFileSync(
  'src/app/products/(app)/export/[projectId]/page.tsx',
  'utf8',
)
const websiteWorkspace = readFileSync(
  'src/app/products/(app)/export/[projectId]/website-export-workspace.tsx',
  'utf8',
)
const websitePreview = readFileSync(
  'src/app/products/(app)/export/[projectId]/website-delivery-preview.tsx',
  'utf8',
)

describe('Export workspace composition', () => {
  it('opens export settings from a TopBar toggle instead of a permanent side panel', () => {
    expect(workspace).toContain('Popover')
    expect(workspace).toMatch(/>\s*导出\s*</)
    expect(workspace).not.toContain('导出 MP4')
    expect(workspace).toContain('ExportSettings')
    expect(workspace).toContain('ExportDeliveryCheck')
    expect(workspace).not.toContain('ExportReview')
    expect(workspace).not.toContain('DrawerOverlay')
    expect(workspace).not.toContain('useResizablePanel')
    expect(workspace).not.toContain('variant="tinted"')
  })

  it('keeps the delivery check as a full-width section under the pipeline timeline', () => {
    const previewIdx = workspace.indexOf('ExportPreview')
    const timelineIdx = workspace.indexOf('ExportTimeline')
    const qaIdx = workspace.indexOf('<ExportDeliveryCheck')
    expect(previewIdx).toBeGreaterThan(-1)
    expect(timelineIdx).toBeGreaterThan(previewIdx)
    expect(qaIdx).toBeGreaterThan(timelineIdx)
    expect(workspace).toContain('projectId={projectId}')
    expect(deliveryCheck).toContain('交付检查')
    expect(deliveryCheck).toContain('buildExportDeliveryCheck')
    expect(deliveryCheck).toContain('返回画布处理')
    expect(deliveryCheck).not.toContain('ContactSheetThumb')
    expect(deliveryCheck).not.toContain('25% / 60% / 95%')
    expect(deliveryCheck).not.toContain('ArtifactChip')
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
    // 降级导出是独立的高代价 CTA（destructive）；正常开始导出仍为默认 primary。
    expect(settings).toContain('降级导出')
    expect(settings).toContain('variant="destructive"')
    expect(settings).toContain('QA 豁免镜头保持现有画面')
    expect(settings).toContain('明确标记为未验收')
    expect(settings).toContain('本操作需要人工确认')
  })

  it('renders only readiness-backed media tracks and marks BGM/SFX as unwired', () => {
    expect(workspace).toContain('readiness={runtime.readiness}')
    expect(workspace).toContain('旁白就绪')
    expect(workspace).toContain('字幕就绪')
    // 音乐与音效是纯接口预留（generateScore / generateSfx 是桩，无写入方，
    // concat 的配乐分支永不执行）。文案必须说清是「未实现」而不是含糊的「未接线」，
    // 且不得给出可点击却没有行为的开关。
    expect(workspace).toContain('接口预留 · 未实现')
    expect(workspace).not.toContain('未接线')
    // 关闭字幕交付时显示「本次不入片」，不得把未测量塌成 0/5。
    expect(workspace).toContain('本次不入片')
    // 硬编码刻度尺与常量宽 clip 都已移除：位置与宽度只能来自真实通道次序。
    expect(workspace).not.toContain("'00:20'")
    expect(workspace).not.toContain('fullTrackClip')
    expect(settings).toContain('硬字幕烧录')
    expect(settings).toContain('旧版静音成片')
    expect(settings).not.toContain('暂不支持（P1）')
  })

  it('shows lane-scoped media blockers with human-readable labels', () => {
    expect(viewModel).toContain('blockingIssueLabel')
    expect(contract).toContain('缺旁白')
    expect(contract).toContain('缺字幕')
    expect(contract).toContain('产物无效')
  })

  it('dispatches website projects before loading the shot timeline workspace', () => {
    const websiteBranch = page.indexOf("project.kind === 'website'")
    const graphRead = page.indexOf('getCanvasGraph(projectId)')
    expect(websiteBranch).toBeGreaterThan(-1)
    expect(graphRead).toBeGreaterThan(websiteBranch)
    expect(page).toContain('getProjectExecutionSnapshot(projectId)')
    expect(page).toContain('<WebsiteExportWorkspace')
  })

  it('keeps website delivery on the execution snapshot instead of timeline export controls', () => {
    expect(websiteWorkspace).toContain('useProjectExecution')
    expect(websiteWorkspace).toContain('WebsiteExportStageList')
    expect(websiteWorkspace).toContain('websiteDeliveryForDownload')
    expect(websiteWorkspace).not.toContain('TimelineTrack')
    expect(websiteWorkspace).not.toContain('startProjectExport')
    expect(websiteWorkspace).not.toContain('BGM')
    expect(websiteWorkspace).not.toContain('SFX')
    expect(websitePreview).toContain('<video')
    expect(websitePreview).toContain('内容哈希')
    expect(websitePreview).toContain('Golden 校验')
  })
})
