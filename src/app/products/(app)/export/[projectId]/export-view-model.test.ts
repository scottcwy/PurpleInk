import { describe, expect, it } from 'vitest'
import type { ExportReadiness } from './export-readiness-contract'
import {
  buildExportDeliveryCheck,
  buildTimelineSpans,
  buildResolutionOptions,
  formatTimelineDuration,
} from './export-view-model'

describe('export view model', () => {
  it('lays clips out from real frame durations in timeline order', () => {
    expect(buildTimelineSpans(timeline())).toEqual([
      { start: 0, width: 0.2, label: 'S001' },
      { start: 0.2, width: 0.3, label: 'S002' },
      { start: 0.5, width: 0.5, label: 'S003' },
    ])
  })

  it('leaves the real-duration gap for a missing lane instead of shifting later lanes', () => {
    // 回归锁：S002 缺产物时 S003 必须留在第三格。旧实现按过滤后的数组重新编号，
    // 把 S003 画到第二格，暗示错误的时间位置且与分镜轨对不齐。
    expect(buildTimelineSpans(timeline(), ['S001', 'S003'])).toEqual([
      { start: 0, width: 0.2, label: 'S001' },
      { start: 0.5, width: 0.5, label: 'S003' },
    ])
  })

  it('stays empty without a real timeline instead of falling back to equal fake slots', () => {
    expect(buildTimelineSpans(null)).toEqual([])
  })

  it('ignores present lanes that are absent from the timeline contract', () => {
    expect(buildTimelineSpans(timeline(), ['S001', 'S404'])).toEqual([
      { start: 0, width: 0.2, label: 'S001' },
    ])
  })

  it('formats the total duration from frames and fps', () => {
    expect(formatTimelineDuration(timeline())).toBe('00:10')
    expect(
      formatTimelineDuration({
        fps: 30,
        totalFrames: 95,
        shots: [{ laneKey: 'S001', durationInFrames: 95 }],
      })
    ).toBe('00:03.2')
    expect(formatTimelineDuration(null)).toBe('时间未就绪')
  })

  it('projects every supported resolution preset to its existing tier label', () => {
    expect(buildResolutionOptions()).toEqual([
      { value: '1920x1080', label: '高清' },
      { value: '1280x720', label: '标清' },
      { value: '960x540', label: '流畅' },
    ])
  })

  it('projects a fully ready delivery from real render, media, and QA counts', () => {
    const result = buildExportDeliveryCheck(
      ['S002', 'S001'],
      readiness({
        ready: true,
        shotCount: 2,
        shotQa: { S001: true, S002: true },
        media: {
          narrationReadyCount: 2,
          subtitleReadyCount: 2,
          requiredShotCount: 2,
          delivery: 'narration-hard-subtitle-v2',
        },
      }),
    )

    expect(result).toMatchObject({
      state: 'ready',
      statusLabel: '可完整导出',
      incompleteNodeCount: 0,
      issues: [],
      metrics: [
        { key: 'render', value: '2/2', state: 'ready' },
        { key: 'narration', value: '2/2', state: 'ready' },
        { key: 'subtitle', value: '2/2', state: 'ready' },
        { key: 'qa', value: '2/2', state: 'ready' },
      ],
    })
  })

  it('keeps failed, pending, and waived QA distinct and never counts a waiver as passed', () => {
    const result = buildExportDeliveryCheck(
      ['S004', 'S002', 'S001', 'S003'],
      readiness({
        ready: true,
        degradedReady: true,
        shotCount: 3,
        shotQa: { S001: true, S002: false, S003: null, S004: true },
        waivedQaLanes: ['S004'],
        incompleteNodeIds: ['qa-s002', 'qa-s003', 'qa-s004'],
        blockingIssues: [
          { laneKey: 'S001', kind: 'narration', code: 'artifact-missing' },
        ],
        media: {
          narrationReadyCount: 3,
          subtitleReadyCount: 4,
          requiredShotCount: 4,
          delivery: 'narration-hard-subtitle-v2',
        },
      }),
    )

    expect(result.state).toBe('degraded')
    expect(result.statusLabel).toBe('可降级交付')
    expect(result.metrics.find((metric) => metric.key === 'qa')).toEqual({
      key: 'qa',
      label: '镜头验收',
      value: '1/4',
      detail: '1 镜未通过 · 1 镜待验收 · 1 镜未验收',
      state: 'warning',
    })
    expect(result.issues.map((issue) => issue.label)).toEqual([
      'S001 缺旁白',
      'S002 · 镜头验收未通过',
      'S003 · 等待镜头验收',
      'S004 · 已豁免，仍属未验收',
    ])
    expect(result.incompleteNodeCount).toBe(3)
  })

  it('states when subtitles are intentionally excluded and when no media contract exists', () => {
    const result = buildExportDeliveryCheck(
      ['S001'],
      readiness({
        ready: false,
        shotCount: 0,
        subtitles: 'off',
        media: {
          narrationReadyCount: 0,
          subtitleReadyCount: null,
          requiredShotCount: 0,
          delivery: 'narration-no-subtitle-v3',
        },
      }),
    )

    expect(result.state).toBe('needs-attention')
    expect(result.metrics).toEqual([
      {
        key: 'render',
        label: '镜头画面',
        value: '0/1',
        detail: '已登记可用渲染产物',
        state: 'pending',
      },
      {
        key: 'narration',
        label: '旁白',
        value: '尚未建立',
        detail: '媒体时间合同尚未就绪',
        state: 'pending',
      },
      {
        key: 'subtitle',
        label: '字幕',
        value: '本次不入片',
        detail: '导出设置已关闭字幕交付',
        state: 'ready',
      },
      {
        key: 'qa',
        label: '镜头验收',
        value: '0/1',
        detail: '1 镜待验收',
        state: 'pending',
      },
    ])
  })
})

function readiness(overrides: Partial<ExportReadiness> = {}): ExportReadiness {
  return {
    ready: false,
    incompleteNodeIds: [],
    shotCount: 0,
    shotQa: {},
    resolutionPreset: '1920x1080',
    subtitles: 'burn-in',
    soundEffects: 'off',
    artifactSoundEffects: null,
    timeline: null,
    blockingIssues: [],
    media: {
      narrationReadyCount: 0,
      subtitleReadyCount: 0,
      requiredShotCount: 0,
      delivery: 'narration-hard-subtitle-v2',
    },
    placeholderCandidateLanes: [],
    waivedQaLanes: [],
    degradedReady: false,
    confirmationFingerprint: null,
    degradedExport: null,
    artifactDelivery: 'none',
    ...overrides,
  }
}

function timeline(): NonNullable<ExportReadiness['timeline']> {
  return {
    fps: 30,
    totalFrames: 300,
    shots: [
      { laneKey: 'S001', durationInFrames: 60 },
      { laneKey: 'S002', durationInFrames: 90 },
      { laneKey: 'S003', durationInFrames: 150 },
    ],
  }
}
