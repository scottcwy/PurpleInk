import type {
  WorkflowFaultOrigin,
  WorkflowRecovery,
} from './workflow-fault'

export interface WorkflowFaultDisplayInput {
  stage: string
  message: string
  code?: string
  origin?: string
  title?: string
  recovery?: string
  provider?: {
    id: string
    label: string
    httpStatus?: number
    retryAt?: string
  }
  referenceId?: string
  occurredAt?: string
}

export interface WorkflowFaultDisplay {
  title: string
  responsibility: string
  origin: WorkflowFaultOrigin
  recovery: WorkflowRecovery
  happened: string
  systemAction: string
  userAction: string
}

export type WorkflowRecoveryAction =
  | 'cancel_wait'
  | 'confirm_degraded_export'
  | 'contact_support'
  | 'edit_input'
  | 'fix_settings'
  | 'manual_retry'
  | 'switch_provider'
  | 'upgrade_plan'

const RECOVERY_ACTIONS: Record<
  WorkflowRecovery,
  readonly WorkflowRecoveryAction[]
> = {
  auto_wait: ['switch_provider', 'cancel_wait'],
  confirm_degraded_export: ['confirm_degraded_export'],
  manual_retry: ['manual_retry'],
  fix_settings: ['fix_settings'],
  upgrade_plan: ['upgrade_plan'],
  edit_input: ['edit_input'],
  switch_provider: ['switch_provider'],
  contact_support: ['contact_support'],
}

export function workflowRecoveryActions(
  recovery: WorkflowRecovery
): readonly WorkflowRecoveryAction[] {
  return RECOVERY_ACTIONS[recovery]
}

export function workflowFaultDisplay(
  fault: WorkflowFaultDisplayInput
): WorkflowFaultDisplay {
  const origin = isOrigin(fault.origin) ? fault.origin : 'unknown'
  const recovery = isRecovery(fault.recovery) ? fault.recovery : 'manual_retry'
  return {
    title: fault.title ?? legacyTitle(fault),
    responsibility: responsibilityLabel(origin),
    origin,
    recovery,
    happened: fault.message || '该阶段没有返回可公开的错误说明。',
    systemAction: systemAction(recovery),
    userAction: userAction(recovery),
  }
}

export function responsibilityLabel(origin: WorkflowFaultOrigin): string {
  return {
    user: '需要你处理',
    platform: '平台执行问题',
    provider: '第三方服务问题',
    content: '内容或素材问题',
    unknown: '正在诊断',
  }[origin]
}

function systemAction(recovery: WorkflowRecovery): string {
  switch (recovery) {
    case 'auto_wait':
      return '任务保持在队列中，系统会在限流窗口结束后自动继续。'
    case 'manual_retry':
      return '系统已保留当前进度，等待你确认后重新执行。'
    case 'fix_settings':
    case 'upgrade_plan':
      return '系统已停止无效重试，避免继续消耗时间或额度。'
    case 'edit_input':
      return '系统已拒绝当前坏版本，不会把它作为可用产物继续传递。'
    case 'switch_provider':
      return '系统保留了当前模型选择，不会在未经确认时擅自切换。'
    case 'contact_support':
      return '系统已生成安全参考号，技术人员可据此定位服务端记录。'
    case 'confirm_degraded_export':
      return '系统已保留可用产物，并暂停导出以等待你的明确确认。'
    default:
      return '系统正在保留现场并等待进一步诊断。'
  }
}

function userAction(recovery: WorkflowRecovery): string {
  switch (recovery) {
    case 'auto_wait':
      return '可以等待自动恢复，也可以切换模型或取消等待。'
    case 'manual_retry':
      return '服务恢复后重新执行即可。'
    case 'fix_settings':
      return '请前往模型设置检查你配置的 Key、端点和模型权限。'
    case 'upgrade_plan':
      return '请检查账户余额、套餐或平台额度。'
    case 'edit_input':
      return '请返回原稿或素材，修改不符合要求的内容。'
    case 'switch_provider':
      return '可以打开模型路由设置，选择其他供应商。'
    case 'contact_support':
      return '请复制参考号并联系支持，无需提供 Prompt 或凭据。'
    case 'confirm_degraded_export':
      return '请确认是否接受缺少非关键产物的降级导出。'
    default:
      return '请稍后重试；若持续失败，请使用参考号联系支持。'
  }
}

function legacyTitle(fault: WorkflowFaultDisplayInput): string {
  if (fault.code === 'QUOTA_EXHAUSTED') return '本周期 AI 额度已用完'
  return fault.stage ? `${fault.stage} 阶段执行未完成` : '阶段执行未完成'
}

function isOrigin(value: string | undefined): value is WorkflowFaultOrigin {
  return ['user', 'platform', 'provider', 'content', 'unknown'].includes(value ?? '')
}

function isRecovery(value: string | undefined): value is WorkflowRecovery {
  return [
    'auto_wait',
    'manual_retry',
    'fix_settings',
    'upgrade_plan',
    'edit_input',
    'switch_provider',
    'contact_support',
  ].includes(value ?? '')
}
