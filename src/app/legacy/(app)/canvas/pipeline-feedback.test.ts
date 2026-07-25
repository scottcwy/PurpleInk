import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describePipelineResult } from './pipeline-feedback'

describe('describePipelineResult', () => {
  it('保留部分入队失败的真实结果', () => {
    expect(
      describePipelineResult({
        autopilot: true,
        enqueuedNodeIds: ['n1', 'n2'],
        failedNodeIds: ['n3'],
      })
    ).toEqual({
      variant: 'error',
      title: '工作流已启动，但有节点入队失败',
      body: '已入队 2 个节点，失败 1 个节点。',
    })
  })

  it('描述启动成功时的真实入队数量', () => {
    expect(
      describePipelineResult({
        autopilot: true,
        enqueuedNodeIds: ['n1', 'n2'],
        failedNodeIds: [],
      })
    ).toEqual({
      variant: 'success',
      title: '工作流已启动',
      body: '已入队 2 个节点。',
    })
  })

  it('停止自动推进时不伪装取消已入队作业', () => {
    expect(describePipelineResult({ autopilot: false })).toEqual({
      variant: 'success',
      title: '已停止自动推进',
      body: '已入队作业不会被伪装为已取消。',
    })
  })
})

describe('Canvas pipeline feedback wiring', () => {
  const fixedAutosaveCopy = ['已自动', '保存'].join('')
  const fixedProgressValue = ['value={', '100}'].join('')
  const canvasViewSource = readFileSync(
    new URL('./canvas-view.tsx', import.meta.url),
    'utf8'
  )
  const inspectorSource = readFileSync(
    new URL('./canvas-inspector.tsx', import.meta.url),
    'utf8'
  )

  it('消费真实 pipeline 返回值且不显示无来源的自动保存状态', () => {
    expect(canvasViewSource).toContain('describePipelineResult(result)')
    expect(canvasViewSource).not.toContain(fixedAutosaveCopy)
  })

  it('将 jobId 明确传给本地已入队反馈且不显示固定百分比', () => {
    expect(inspectorSource).toContain('onQueued(jobId)')
    expect(inspectorSource).toContain('title="已入队"')
    expect(inspectorSource).toContain('variant="info"')
    expect(inspectorSource).not.toContain(fixedProgressValue)
  })
})
