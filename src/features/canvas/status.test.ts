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
      set: () => ({ where: async () => undefined }),
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
