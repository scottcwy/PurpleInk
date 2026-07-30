import { describe, expect, it } from 'vitest'
import type {
  ProjectExecutionSnapshot,
  WebsiteStageSnapshot,
} from '@/features/projects'
import {
  executionActionPresentation,
  websiteStagePresentation,
} from './website-execution-presentation'

describe('website execution presentation', () => {
  it('uses the six real stage names and waiting semantics', () => {
    expect(websiteStagePresentation(snapshot('idle'), stage('capture', 'idle'), 0))
      .toEqual({ title: '网站采集', status: '待启动' })
    expect(websiteStagePresentation(snapshot('idle'), stage('script', 'idle'), 1))
      .toEqual({ title: '介绍脚本', status: '等待上一阶段' })
  })

  it('shows the real engine action and recovery state', () => {
    expect(websiteStagePresentation(
      snapshot('running'),
      { ...stage('narration', 'running'), enginePhase: 'synthesizing' },
      2,
    )).toEqual({ title: '旁白生成', status: '正在生成旁白' })
    expect(websiteStagePresentation(
      snapshot('recovering'),
      { ...stage('render', 'running'), enginePhase: 'rendering' },
      4,
    )).toEqual({ title: '视频渲染', status: '执行器正在恢复' })
  })

  it('never labels a verification block as success', () => {
    expect(websiteStagePresentation(
      snapshot('blocked'),
      {
        ...stage('export', 'blocked'),
        failureCode: 'WEBSITE_VERIFICATION_FAILED',
      },
      5,
    )).toEqual({
      title: '成片验收与导出',
      status: '成片已生成，质量验收未通过',
    })
  })

  it.each([
    ['idle', 'start', '一键启动'],
    ['running', 'stop', '停止项目'],
    ['recovering', 'stop', '停止项目'],
    ['stopping', 'busy', '正在安全停止'],
    ['succeeded', 'download', '查看并下载 MP4'],
    ['failed', 'start', '重新启动'],
    ['cancelled', 'start', '重新启动'],
    ['blocked', 'start', '重新生成'],
  ] as const)('maps %s to the truthful primary action', (state, mode, label) => {
    expect(executionActionPresentation(snapshot(state))).toEqual({ mode, label })
  })
})

function stage(
  phase: WebsiteStageSnapshot['phase'],
  state: WebsiteStageSnapshot['state'],
): WebsiteStageSnapshot {
  return {
    nodeId: `${phase}-node`,
    phase,
    state,
    updatedAt: '2026-07-30T00:00:00.000Z',
  }
}

function snapshot(
  state: ProjectExecutionSnapshot['state'],
): ProjectExecutionSnapshot {
  const active = ['queued', 'running', 'stopping', 'recovering'].includes(state)
  return {
    workflowKind: 'website',
    state,
    active,
    canStart: !active && state !== 'succeeded',
    canStop: active,
    attempt: null,
    currentStage: null,
    stages: [],
    delivery: null,
    revision: 'a'.repeat(64),
  }
}
