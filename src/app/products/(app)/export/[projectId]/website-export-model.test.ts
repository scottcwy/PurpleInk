import { describe, expect, it } from 'vitest'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import {
  websiteDeliveryForDownload,
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
    execution.stages[4] = { ...execution.stages[4]!, state: 'running' }
    expect(websiteExportProgress(execution)).toEqual({
      completed: 4,
      total: 6,
      label: '已完成 4/6 阶段',
    })
    execution.stages.pop()
    expect(websiteExportProgress(execution).label).toBe('已完成 4/6 阶段')
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
    workflowKind: 'website',
    state,
    active: ['queued', 'running', 'recovering', 'stopping'].includes(state),
    canStart: ['idle', 'failed', 'cancelled', 'blocked'].includes(state),
    canStop: ['queued', 'running', 'recovering'].includes(state),
    attempt,
    currentStage: null,
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
      contentHash: 'a'.repeat(64),
      sizeBytes: 1024,
      version: 1,
      verification: {
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 1,
        outcome: 'passed',
      },
      downloadUrl: '/api/artifacts/artifact-1?projectId=project-1',
    },
    revision: 'b'.repeat(64),
  }
}
