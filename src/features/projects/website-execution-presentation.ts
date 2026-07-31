import type {
  ProjectExecutionSnapshot,
  WebsiteStageSnapshot,
} from './project-execution-contract'

const PHASE_TITLE: Record<WebsiteStageSnapshot['phase'], string> = {
  capture: '网站采集',
  script: '介绍脚本',
  narration: '旁白生成',
  compose: '画面合成',
  render: '视频渲染',
  export: '成片验收与导出',
}

const ENGINE_ACTION: Record<
  NonNullable<WebsiteStageSnapshot['enginePhase']>,
  string
> = {
  queued: '等待执行器',
  capturing: '正在采集网站',
  scripting: '正在生成介绍脚本',
  synthesizing: '正在生成旁白',
  timing: '正在对齐旁白时序',
  composing: '正在合成画面',
  rendering: '正在渲染视频',
  verifying: '正在执行成片校验',
  muxing: '正在封装 MP4',
  done: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
}

export interface WebsiteStagePresentation {
  title: string
  status: string
}

export function websiteExecutionStages(
  execution: ProjectExecutionSnapshot,
): readonly WebsiteStageSnapshot[] {
  return execution.detail.kind === 'website' ? execution.detail.stages : []
}

export function websiteStagePresentation(
  execution: ProjectExecutionSnapshot,
  stage: WebsiteStageSnapshot,
  index: number,
): WebsiteStagePresentation {
  let status: string
  if (stage.state === 'idle') {
    status = index === 0 ? '待启动' : '等待上一阶段'
  } else if (stage.state === 'queued') {
    status = '等待执行器'
  } else if (stage.state === 'running') {
    status = execution.state === 'recovering'
      ? '执行器正在恢复'
      : stage.enginePhase
        ? ENGINE_ACTION[stage.enginePhase]
        : '正在执行'
  } else if (stage.state === 'succeeded') {
    status = '已完成'
  } else if (stage.state === 'blocked') {
    status = stage.failureCode === 'WEBSITE_VERIFICATION_FAILED'
      ? '成片已生成，质量验收未通过'
      : '执行结果不一致，需要重新生成'
  } else if (stage.state === 'failed') {
    status = failureLabel(stage.failureCode)
  } else {
    const previousFailed = websiteExecutionStages(execution)
      .slice(0, index)
      .some((candidate) =>
        candidate.state === 'failed' || candidate.state === 'blocked')
    status = previousFailed ? '因前序失败未执行' : '已取消'
  }
  return { title: PHASE_TITLE[stage.phase], status }
}

export function executionActionPresentation(
  execution: ProjectExecutionSnapshot,
): {
  mode: 'start' | 'stop' | 'busy' | 'download'
  label: string
} {
  if (execution.state === 'stopping') {
    return { mode: 'busy', label: '正在安全停止' }
  }
  if (
    execution.state === 'queued'
    || execution.state === 'running'
    || execution.state === 'recovering'
  ) {
    return { mode: 'stop', label: '停止项目' }
  }
  if (execution.state === 'succeeded') {
    return { mode: 'download', label: '查看并下载 MP4' }
  }
  if (execution.state === 'blocked') {
    return { mode: 'start', label: '重新生成' }
  }
  if (execution.state === 'failed' || execution.state === 'cancelled') {
    return { mode: 'start', label: '重新启动' }
  }
  return { mode: 'start', label: '一键启动' }
}

export function projectExecutionLabel(
  state: ProjectExecutionSnapshot['state'],
): string {
  return {
    idle: '未启动',
    queued: '等待执行器',
    running: '执行中',
    stopping: '正在安全停止',
    recovering: '执行器正在恢复',
    succeeded: '已完成',
    blocked: '质量验收阻塞',
    failed: '执行失败',
    cancelled: '已取消',
  }[state]
}

export function websitePhaseBorderClass(
  phase: WebsiteStageSnapshot['phase'],
): string {
  return {
    capture: 'border-stage-ingest',
    script: 'border-stage-direct',
    narration: 'border-stage-audio',
    compose: 'border-stage-shot',
    render: 'border-stage-assemble',
    export: 'border-stage-finalize',
  }[phase]
}

function failureLabel(
  code: WebsiteStageSnapshot['failureCode'],
): string {
  if (code === 'WEBSITE_ENGINE_TIMEOUT') return '执行超时，可以重新启动'
  if (code === 'WEBSITE_ENGINE_UNAVAILABLE') return '执行器暂时不可用，可以重试'
  if (code === 'WEBSITE_VIDEO_INVALID') return '生成的视频文件无效'
  if (code === 'WEBSITE_PROJECT_INVALID') return '项目参数无效'
  return '执行失败，可以重新启动'
}
