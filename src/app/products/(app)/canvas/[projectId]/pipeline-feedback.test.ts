import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describePipelineResult } from './pipeline-feedback'

describe('describePipelineResult', () => {
  it('零入队且未完成时明确显示工作流被阻塞', () => {
    expect(
      describePipelineResult({
        autopilot: true,
        status: 'blocked',
        enqueuedNodeIds: [],
        blockedNodes: [
          {
            nodeId: 'n1',
            code: 'CONFIGURATION_BLOCKED',
            message: '请先完成模型配置',
          },
        ],
      })
    ).toEqual({
      variant: 'error',
      title: '工作流被阻塞',
      body: '请先完成模型配置',
    })
  })

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

  it('停止中明确显示剩余运行作业', () => {
    expect(describePipelineResult({
      autopilot: false,
      status: 'stopping',
      remainingRunning: 2,
    })).toEqual({
      variant: 'info',
      title: '正在停止项目',
      body: '仍有 2 个作业正在安全退出。',
    })
  })

  it('停止完成后汇总已收敛资源', () => {
    expect(describePipelineResult({
      autopilot: false,
      status: 'stopped',
      cancelledAttempts: 3,
      cancelledRuns: 2,
      cancelledTickets: 1,
      cancelledLeases: 2,
      remainingRunning: 0,
    })).toEqual({
      variant: 'success',
      title: '项目已停止',
      body: '已收敛 8 项排队或执行资源，可以安全删除项目。',
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
  // Inspector 拆为容器（收起/抽屉逻辑）与呈现层（节点详情）两个文件，
  // 反馈接线断言覆盖两者拼接后的源码。
  const inspectorSource = [
    readFileSync(new URL('./canvas-inspector.tsx', import.meta.url), 'utf8'),
    readFileSync(
      new URL('./canvas-inspector-body.tsx', import.meta.url),
      'utf8',
    ),
  ].join('\n')
  const streamingLogSource = readFileSync(
    new URL('./streaming-log-card.tsx', import.meta.url),
    'utf8'
  )
  const stageErrorDialogSource = readFileSync(
    new URL('./stage-error-dialog.tsx', import.meta.url),
    'utf8'
  )

  it('消费真实 pipeline 返回值且不显示无来源的自动保存状态', () => {
    expect(canvasViewSource).toContain('describePipelineResult(result)')
    expect(canvasViewSource).toContain("'停止项目'")
    expect(canvasViewSource).toContain('executionActionPresentation(execution)')
    expect(canvasViewSource).not.toContain(fixedAutosaveCopy)
  })

  it('将 jobId 明确传给本地已入队反馈且不显示固定百分比', () => {
    expect(inspectorSource).toContain('onQueued(result.jobId)')
    expect(inspectorSource).toContain('title="已入队"')
    expect(inspectorSource).toContain('variant="info"')
    expect(inspectorSource).not.toContain(fixedProgressValue)
  })

  it('配置阻塞时禁用画布动作且错误弹窗不提供无效重试', () => {
    expect(inspectorSource).toContain('isNodeActionBlocked(node)')
    expect(streamingLogSource).toContain('retryable={error?.retryable !== false}')
    expect(stageErrorDialogSource).toContain("actions.includes('manual_retry')")
  })

  it('额度耗尽复用阶段错误弹窗并引导到真实计费页', () => {
    expect(canvasViewSource).toContain("<StageErrorDialog")
    expect(canvasViewSource).toContain("code === 'quota_exhausted'")
    expect(canvasViewSource).toContain('onQuotaExhausted={() => setPipelineQuotaOpen(true)}')
    expect(inspectorSource).toContain('cause instanceof BillingQuotaExhaustedError')
    expect(inspectorSource).toContain('onQuotaExhausted()')
    expect(streamingLogSource).toContain('errorCode={error?.code}')
    expect(stageErrorDialogSource).toContain("errorCode === 'quota_exhausted'")
    expect(stageErrorDialogSource).toContain('PRODUCTS_ROUTES.billing')
    expect(stageErrorDialogSource).toContain('getQuotaUpgradeDirection')
    expect(stageErrorDialogSource).toContain('Max 已是最高额度')
  })

  it('pipeline 反馈锚定在画布主区右上角，避开左侧泳道折叠与顶栏', () => {
    const feedbackMount = canvasViewSource.match(
      /data-slot="pipeline-feedback"[\s\S]{0,280}className="([^"]+)"/,
    )
    expect(feedbackMount?.[1]).toBeTruthy()
    const className = feedbackMount?.[1] ?? ''
    expect(className).toContain('absolute')
    expect(className).toContain('right-')
    expect(className).toMatch(/top-(?:1[4-9]|[2-9]\d)/)
    expect(className).not.toContain('inset-x-0')
    expect(className).toContain('max-w-')
  })
})
