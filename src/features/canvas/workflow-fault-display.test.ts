import { describe, expect, it } from 'vitest'
import {
  workflowFaultDisplay,
  workflowRecoveryActions,
} from './workflow-fault-display'

describe('workflowFaultDisplay', () => {
  it.each([
    ['user', '需要你处理'],
    ['platform', '平台执行问题'],
    ['provider', '第三方服务问题'],
    ['content', '内容或素材问题'],
    ['unknown', '正在诊断'],
  ])('maps %s responsibility to one shared label', (origin, responsibility) => {
    expect(workflowFaultDisplay({
      stage: 'INGEST',
      message: 'safe',
      origin,
    }).responsibility).toBe(responsibility)
  })

  it('keeps legacy v1 errors displayable', () => {
    expect(workflowFaultDisplay({
      stage: 'FABRICATE',
      message: '旧错误',
    })).toMatchObject({
      title: 'FABRICATE 阶段执行未完成',
      recovery: 'manual_retry',
      happened: '旧错误',
    })
  })

  it.each([
    ['auto_wait', ['switch_provider', 'cancel_wait']],
    ['confirm_degraded_export', ['confirm_degraded_export']],
    ['manual_retry', ['manual_retry']],
    ['fix_settings', ['fix_settings']],
    ['upgrade_plan', ['upgrade_plan']],
    ['edit_input', ['edit_input']],
    ['switch_provider', ['switch_provider']],
    ['contact_support', ['contact_support']],
  ] as const)('limits %s to its allowed recovery actions', (recovery, actions) => {
    expect(workflowRecoveryActions(recovery)).toEqual(actions)
  })
})
