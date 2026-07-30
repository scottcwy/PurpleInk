import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const publishStatus = vi.fn()
vi.mock('@/lib/stream/status-bus', () => ({
  statusBus: {
    publishStatus: (...args: unknown[]) => publishStatus(...args),
    publishTopology: vi.fn(),
  },
}))

vi.mock('@/lib/db/client', () => ({
  getDb: async () => ({}),
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))

/** 受控事务替身：记录提交时刻，供断言「发布严格在提交之后」。 */
const transactionState = { committed: false }
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: async (
    _db: unknown,
    operation: (tx: unknown) => Promise<unknown>
  ) => {
    const result = await operation(currentTx())
    transactionState.committed = true
    return result
  },
}))

interface FakeNodeRow {
  id: string
  projectId: string
  status: string
  data: unknown
}

let nodeRows: FakeNodeRow[] = []
/** 捕获每次 update().set(...) 的实参，供断言持久化状态与 data 修订。 */
let updateSets: Array<Record<string, unknown>> = []

function currentTx(): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          // transitionNodeStatus 的行锁查询终结在 .for('update')。
          for: async () => nodeRows,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values)
        return { where: async () => undefined }
      },
    }),
  }
}

import { transitionNodeStatus } from './status'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

describe('transitionNodeStatus 状态事件发布', () => {
  beforeEach(() => {
    publishStatus.mockReset()
    transactionState.committed = false
    nodeRows = []
    updateSets = []
  })

  it('合法迁移在事务提交后恰好发布一次领域态事件', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'queued', data: { payload: {} } },
    ]
    let committedAtPublish: boolean | undefined
    publishStatus.mockImplementation(() => {
      committedAtPublish = transactionState.committed
    })

    await transitionNodeStatus('n1', 'running')

    expect(publishStatus).toHaveBeenCalledTimes(1)
    expect(publishStatus).toHaveBeenCalledWith('p1', 'n1', 'running')
    expect(committedAtPublish).toBe(true)
  })

  it('非法迁移抛错且零发布（防幽灵事件）', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'idle', data: { payload: {} } },
    ]

    await expect(transitionNodeStatus('n1', 'success')).rejects.toThrow(
      '非法节点状态转换'
    )
    expect(publishStatus).not.toHaveBeenCalled()
  })

  it('节点不存在抛错且零发布', async () => {
    nodeRows = []

    await expect(transitionNodeStatus('missing', 'pending')).rejects.toThrow(
      '节点不存在'
    )
    expect(publishStatus).not.toHaveBeenCalled()
  })

  it('发布抛错不影响状态迁移本身', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'queued', data: { payload: {} } },
    ]
    publishStatus.mockImplementation(() => {
      throw new Error('总线故障')
    })

    await expect(transitionNodeStatus('n1', 'cancelled')).resolves.toBeUndefined()
  })

  it('持久化态 queued/succeeded 映射为领域态 pending/success 后发布', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'failed', data: { payload: {} } },
    ]

    await transitionNodeStatus('n1', 'pending')

    expect(publishStatus).toHaveBeenCalledWith('p1', 'n1', 'pending')
  })
})

const SKIP_META = { reason: '素材缺失，先用占位继续', at: '2026-07-28T00:00:00.000Z' }
const WORKFLOW_BLOCK = {
  code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED' as const,
  message: '当前终片需要使用占位镜头，请确认降级交付。',
  recovery: 'confirm_degraded_export' as const,
  referenceId: 'block-ref-1',
  blockedAt: '2026-07-29T06:25:05.000Z',
  confirmationFingerprint: 'sha256:degraded-input',
}

/** 领域态 -> 持久化种子（pending↔queued、success↔succeeded，skipped 原样）。 */
const PERSISTED_SEED = {
  idle: 'idle',
  pending: 'queued',
  running: 'running',
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  stale: 'stale',
  skipped: 'skipped',
  blocked: 'blocked',
} as const

describe('blocked 状态转移', () => {
  beforeEach(() => {
    publishStatus.mockReset()
    transactionState.committed = false
    nodeRows = []
    updateSets = []
  })

  it.each(['idle', 'failed', 'stale'] as const)(
    '%s -> blocked 合法并持久化可审计确认门禁',
    async (current) => {
      nodeRows = [{
        id: 'n1',
        projectId: 'p1',
        status: PERSISTED_SEED[current],
        data: { payload: { directorError: { message: '旧错误' }, keep: 'x' } },
      }]

      await transitionNodeStatus('n1', 'blocked', { workflowBlock: WORKFLOW_BLOCK })

      expect(updateSets[0]?.status).toBe('blocked')
      expect(updateSets[0]?.data).toEqual({
        payload: { keep: 'x', workflowBlock: WORKFLOW_BLOCK },
      })
      expect(publishStatus).toHaveBeenCalledWith('p1', 'n1', 'blocked')
    },
  )

  it('转入 blocked 没有 workflowBlock 时拒绝写入', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'failed', data: { payload: {} } },
    ]

    await expect(transitionNodeStatus('n1', 'blocked')).rejects.toThrow(
      '必须提供 workflowBlock',
    )
    expect(updateSets).toHaveLength(0)
  })

  it('blocked 只能经确认回 pending，并清除 workflowBlock', async () => {
    nodeRows = [{
      id: 'n1',
      projectId: 'p1',
      status: 'blocked',
      data: { payload: { workflowBlock: WORKFLOW_BLOCK, keep: 'x' } },
    }]

    await transitionNodeStatus('n1', 'pending')

    expect(updateSets[0]?.status).toBe('queued')
    expect(updateSets[0]?.data).toEqual({ payload: { keep: 'x' } })
  })

  it('允许运行节点原子转为 Provider 等待并清理旧失败投影', async () => {
    const executionNotice = {
      code: 'PROVIDER_POOL_WAIT' as const,
      message: '阶跃星辰正在等待可用调用窗口',
      resumeAt: '2026-07-30T05:02:41.400Z',
      providerLabel: '阶跃星辰',
    }
    nodeRows = [{
      id: 'n1',
      projectId: 'p1',
      status: 'running',
      data: {
        payload: {
          directorError: { message: '不应残留的失败' },
          renderError: { message: '旧渲染失败' },
          keep: 'x',
        },
      },
    }]

    await transitionNodeStatus('n1', 'pending', { executionNotice })

    expect(updateSets[0]).toMatchObject({
      status: 'queued',
      data: {
        payload: {
          keep: 'x',
          executionNotice,
        },
      },
    })
    expect(updateSets[0]?.data).not.toHaveProperty('payload.directorError')
    expect(updateSets[0]?.data).not.toHaveProperty('payload.renderError')
  })

  it.each(['idle', 'running', 'success', 'failed', 'cancelled', 'stale', 'skipped', 'blocked'] as const)(
    'blocked -> %s 除 pending 外全部拒绝',
    async (next) => {
      nodeRows = [{
        id: 'n1',
        projectId: 'p1',
        status: 'blocked',
        data: { payload: { workflowBlock: WORKFLOW_BLOCK } },
      }]

      await expect(transitionNodeStatus('n1', next)).rejects.toThrow(
        '非法节点状态转换',
      )
      expect(updateSets).toHaveLength(0)
    },
  )
})

describe('skipped 状态转移全组合', () => {
  beforeEach(() => {
    publishStatus.mockReset()
    transactionState.committed = false
    nodeRows = []
    updateSets = []
  })

  it.each(['failed', 'cancelled', 'stale'] as const)(
    '%s -> skipped 合法，持久化为 skipped 并发布领域态',
    async (current) => {
      nodeRows = [
        { id: 'n1', projectId: 'p1', status: PERSISTED_SEED[current], data: { payload: {} } },
      ]

      await transitionNodeStatus('n1', 'skipped', { skipMeta: SKIP_META })

      expect(updateSets[0]?.status).toBe('skipped')
      expect(publishStatus).toHaveBeenCalledWith('p1', 'n1', 'skipped')
    }
  )

  it.each(['idle', 'pending', 'running', 'success', 'skipped'] as const)(
    '%s -> skipped 必须被拒（零写入零发布）',
    async (current) => {
      nodeRows = [
        { id: 'n1', projectId: 'p1', status: PERSISTED_SEED[current], data: { payload: {} } },
      ]

      await expect(
        transitionNodeStatus('n1', 'skipped', { skipMeta: SKIP_META })
      ).rejects.toThrow('非法节点状态转换')
      expect(updateSets).toHaveLength(0)
      expect(publishStatus).not.toHaveBeenCalled()
    }
  )

  it.each(['idle', 'running', 'success', 'failed', 'cancelled', 'stale', 'skipped'] as const)(
    'skipped -> %s 除 pending 外全部被拒',
    async (next) => {
      nodeRows = [
        { id: 'n1', projectId: 'p1', status: 'skipped', data: { payload: {} } },
      ]

      await expect(transitionNodeStatus('n1', next)).rejects.toThrow(
        '非法节点状态转换'
      )
      expect(publishStatus).not.toHaveBeenCalled()
    }
  )

  it('skipped -> pending 合法（重新执行恢复）且清除 skipMeta', async () => {
    nodeRows = [
      {
        id: 'n1',
        projectId: 'p1',
        status: 'skipped',
        data: { payload: { skipMeta: SKIP_META, keep: 'x' } },
      },
    ]

    await transitionNodeStatus('n1', 'pending')

    expect(updateSets[0]?.status).toBe('queued')
    expect(updateSets[0]?.data).toEqual({ payload: { keep: 'x' } })
    expect(publishStatus).toHaveBeenCalledWith('p1', 'n1', 'pending')
  })

  it('转 skipped 无 skipMeta 必须拒绝（跳过必须可审计）', async () => {
    nodeRows = [
      { id: 'n1', projectId: 'p1', status: 'failed', data: { payload: {} } },
    ]

    await expect(transitionNodeStatus('n1', 'skipped')).rejects.toThrow(
      '必须提供 skipMeta'
    )
    expect(publishStatus).not.toHaveBeenCalled()
  })

  it('转 skipped 清理旧错误字段并写入 skipMeta（skipped 节点不应继续显示可重试错误）', async () => {
    nodeRows = [
      {
        id: 'n1',
        projectId: 'p1',
        status: 'failed',
        data: {
          payload: {
            directorError: { stage: 'FABRICATE', message: 'boom', retryable: true },
            renderError: { message: 'render boom', retryable: true },
            keep: 'x',
          },
        },
      },
    ]

    await transitionNodeStatus('n1', 'skipped', { skipMeta: SKIP_META })

    expect(updateSets[0]?.data).toEqual({
      payload: { keep: 'x', skipMeta: SKIP_META },
    })
  })
})
