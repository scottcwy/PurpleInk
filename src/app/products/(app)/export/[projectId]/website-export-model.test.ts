import { describe, expect, it } from 'vitest'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import {
  websiteDeliveryForDownload,
  websiteDownloadHref,
  websiteExportAction,
  websiteExportProgress,
} from './website-export-model'

describe('website export view model', () => {
  it.each([
    ['idle', 'start', '一键启动'],
    ['queued', 'stop', '停止项目'],
    ['running', 'stop', '停止项目'],
    ['recovering', 'stop', '停止项目'],
    ['stopping', 'busy', '正在安全停止'],
    ['failed', 'start', '重新启动'],
    ['cancelled', 'start', '重新启动'],
    ['blocked', 'start', '重新生成'],
    ['succeeded', 'download', '下载 MP4'],
  ] as const)('maps %s to a truthful primary action', (state, mode, label) => {
    expect(websiteExportAction(snapshot(state))).toEqual({ mode, label })
  })

  it('exposes delivery only for a passed approved artifact from the current attempt', () => {
    const valid = snapshot('succeeded')
    expect(websiteDeliveryForDownload(valid)?.artifactId).toBe('artifact-1')

    expect(
      websiteDeliveryForDownload({
        ...valid,
        delivery: { ...valid.delivery!, lifecycle: 'rejected' },
      }),
    ).toBeNull()
    expect(
      websiteDeliveryForDownload({
        ...valid,
        delivery: { ...valid.delivery!, soundEffects: undefined },
      }),
    ).toBeNull()
    expect(
      websiteDeliveryForDownload({
        ...valid,
        delivery: { ...valid.delivery!, attemptId: 'older-attempt' },
      }),
    ).toBeNull()
    expect(
      websiteDeliveryForDownload({
        ...valid,
        delivery: {
          ...valid.delivery!,
          verification: {
            checkPassed: false,
            goldenVerified: true,
            goldenCheckCount: 1,
            outcome: 'degraded',
          },
        },
      }),
    ).toBeNull()
  })

  it('counts only persisted succeeded stages and never invents a percentage', () => {
    const execution = snapshot('running')
    if (execution.detail.kind !== 'website') throw new Error('expected website detail')
    execution.detail.stages[4] = {
      ...execution.detail.stages[4]!,
      state: 'running',
    }
    expect(websiteExportProgress(execution)).toEqual({
      completed: 4,
      total: 6,
      label: '已完成 4/6 阶段',
    })
    execution.detail.stages.pop()
    expect(websiteExportProgress(execution).label).toBe('已完成 4/6 阶段')
  })

  it('keeps preview inline and opts the explicit download link into attachment mode', () => {
    expect(websiteDownloadHref('/api/artifacts/a-1?projectId=p-1')).toBe(
      '/api/artifacts/a-1?projectId=p-1&download=1',
    )
    expect(websiteDownloadHref('/api/artifacts/a-1')).toBe(
      '/api/artifacts/a-1?download=1',
    )
  })
})

function snapshot(
  state: ProjectExecutionSnapshot['state'],
): ProjectExecutionSnapshot {
  const phases = [
    'capture',
    'script',
    'narration',
    'compose',
    'render',
    'export',
  ] as const
  const attempt = {
    id: 'attempt-1',
    status: state === 'succeeded' ? 'succeeded' as const : 'running' as const,
    updatedAt: '2026-07-31T00:00:00.000Z',
  }
  return {
    schemaVersion: 2,
    projectKind: 'website',
    workflowKind: 'website',
    state,
    active: ['queued', 'running', 'recovering', 'stopping'].includes(state),
    canStart: ['idle', 'failed', 'cancelled', 'blocked'].includes(state),
    canStop: ['queued', 'running', 'recovering'].includes(state),
    attempt,
    currentStage: null,
    currentWork: null,
    failure: null,
    recovery: {
      canStart: ['idle', 'failed', 'cancelled', 'blocked'].includes(state),
      canStop: ['queued', 'running', 'recovering'].includes(state),
      mode: ['queued', 'running', 'recovering'].includes(state) ? 'stop' : 'none',
    },
    detail: {
      kind: 'website',
      stages: phases.map((phase, index) => ({
        nodeId: `node-${phase}`,
        phase,
        state: index < 4 ? 'succeeded' as const : 'idle' as const,
        updatedAt: '2026-07-31T00:00:00.000Z',
      })),
    },
    stages: phases.map((phase, index) => ({
      nodeId: `node-${phase}`,
      phase,
      state: index < 4 ? 'succeeded' as const : 'idle' as const,
      updatedAt: '2026-07-31T00:00:00.000Z',
    })),
    delivery: {
      artifactId: 'artifact-1',
      attemptId: 'attempt-1',
      lifecycle: 'approved',
      schemaVersion: 'cvc.website-video/v1',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1024,
      version: 1,
      verification: {
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 1,
        outcome: 'passed',
      },
      soundEffects: {
        artifactId: 'manifest-1',
        lifecycle: 'approved',
        mode: 'procedural',
        status: 'applied',
        generatorVersion: 'procedural-sfx/1.0.0',
        cueCount: 2,
        timingHash: 'b'.repeat(64),
        cuePlanHash: 'c'.repeat(64),
        waveformHashes: ['d'.repeat(64), 'e'.repeat(64)],
      },
      downloadUrl: '/api/artifacts/artifact-1?projectId=project-1',
    },
    revision: 'b'.repeat(64),
  }
}
