import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const publishTopology = vi.fn()
const { registerWorkflowSlotsInTransaction } = vi.hoisted(() => ({
  registerWorkflowSlotsInTransaction: vi.fn(async () => undefined),
}))
vi.mock('@/features/ai/workspace-concurrency', () => ({
  registerWorkflowSlotsInTransaction,
}))
vi.mock('@/lib/stream/status-bus', () => ({
  statusBus: {
    publishStatus: vi.fn(),
    publishTopology: (...args: unknown[]) => publishTopology(...args),
  },
}))

vi.mock('@/lib/db/client', () => ({
  getDb: async () => ({}),
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))

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

/** 依查询顺序出队：第一次 anchors，第二次已存在的 logicalKey。 */
let selectResults: unknown[][] = []

function currentTx(): unknown {
  return {
    select: () => ({
      from: () => ({
        where: async () => selectResults.shift() ?? [],
      }),
    }),
    insert: () => ({
      values: () =>
        Object.assign(Promise.resolve(), {
          onConflictDoNothing: async () => undefined,
        }),
    }),
  }
}

import { materializeShotLanes } from './fan-out'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

const ANCHORS = [
  { id: 'anchor-split', type: 'shot-split' },
  { id: 'anchor-score', type: 'score' },
]

const LANE_ROLES = [
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
] as const

describe('materializeShotLanes 拓扑事件发布', () => {
  beforeEach(() => {
    publishTopology.mockReset()
    registerWorkflowSlotsInTransaction.mockClear()
    transactionState.committed = false
    selectResults = []
  })

  it('新泳道物化后在事务提交后发布一条 topology 事件', async () => {
    selectResults = [ANCHORS, []]
    let committedAtPublish: boolean | undefined
    publishTopology.mockImplementation(() => {
      committedAtPublish = transactionState.committed
    })

    await materializeShotLanes('p1', ['S001', 'S002'])

    expect(publishTopology).toHaveBeenCalledTimes(1)
    expect(publishTopology).toHaveBeenCalledWith('p1')
    expect(registerWorkflowSlotsInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p1', workUnitKeys: ['S001', 'S002'] }),
    )
    expect(committedAtPublish).toBe(true)
  })

  it('幂等重放（泳道已全部存在）不发拓扑事件', async () => {
    selectResults = [
      ANCHORS,
      LANE_ROLES.map((role) => ({ logicalKey: `shot:S001:${role}` })),
    ]

    await materializeShotLanes('p1', ['S001'])

    expect(publishTopology).not.toHaveBeenCalled()
  })

  it('空输入直接返回，零事件', async () => {
    await materializeShotLanes('p1', [])

    expect(publishTopology).not.toHaveBeenCalled()
  })

  it('泳道数据不完整时抛错且零事件', async () => {
    selectResults = [ANCHORS, [{ logicalKey: 'shot:S001:shot-script' }]]

    await expect(materializeShotLanes('p1', ['S001'])).rejects.toThrow(
      '分镜通道数据不完整'
    )
    expect(publishTopology).not.toHaveBeenCalled()
  })

  it('发布抛错不影响扇出结果', async () => {
    selectResults = [ANCHORS, []]
    publishTopology.mockImplementation(() => {
      throw new Error('总线故障')
    })

    await expect(materializeShotLanes('p1', ['S001'])).resolves.toBeUndefined()
  })
})
