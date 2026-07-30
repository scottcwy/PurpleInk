import { describe, expect, it, vi } from 'vitest'
import { createStageRunner } from './stage-runner'
import type { DirectorRunResult } from './pi-session'
import type { DirectorStageContext } from './runtime-repository'
import { ProviderDispatchWaitError } from '@/features/ai/provider-dispatch-wait-error'
import {
  ArtifactValidationError,
  type ArtifactCommitResult,
} from './tools/write-artifact'

vi.mock('server-only', () => ({}))

/**
 * 工具产物阶段的输出策略。`recover` 是可信校验器回调（模型把实参当文本输出时的抢救路径），
 * 断言只校验它存在，具体行为由 `output-recovery.test.ts` 覆盖。
 */
const SHOT_SPEC_OUTPUT = {
  kind: 'validated-tool-argument',
  toolName: 'validate_shot_plan',
  argumentKey: 'shotPlan',
  recover: expect.any(Function),
}

const FABRICATE_OUTPUT = {
  kind: 'validated-tool-argument',
  toolName: 'check_determinism',
  argumentKey: 'source',
  recover: expect.any(Function),
}

const context: DirectorStageContext = {
  projectId: 'project-1',
  nodeId: 'node-1',
  nodeType: 'script-import',
  stage: 'INGEST',
  status: 'pending',
  projectTitle: '项目',
  projectScript: '脚本',
  directorInput: { rawScript: '脚本' },
  resumeSessionKey: undefined,
}

function directorResult(
  artifactContent: string,
  displayText = artifactContent
): DirectorRunResult {
  return {
    artifactContent,
    displayText,
    provenance: { kind: 'assistant-text' },
  }
}

function artifactResult(): ArtifactCommitResult {
  return {
    id: 'artifact-1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    projectId: 'project-1',
    aggregateType: 'node',
    aggregateId: 'node-1',
    kind: 'director-ingest',
    schemaVersion: 'cvc.director-artifact/v1',
    storageKey: 'director/output.txt',
    sizeBytes: 6,
    contentHash: 'a'.repeat(64),
    attemptId: 'attempt-1',
    storageKeyAlreadyExisted: false,
  }
}

function createHarness(
  run: (input: unknown) => Promise<DirectorRunResult> = vi.fn(
    async (input: unknown) => {
      void input
      return directorResult('业务产物', '展示完成')
    }
  )
) {
  const calls: string[] = []
  const session = {
    id: 'session-1',
    storageKey: 'pi-sessions/project-1/session.jsonl',
    run: vi.fn(async (input: unknown) => {
      calls.push('run')
      return run(input)
    }),
    close: vi.fn(async () => {
      calls.push('close')
    }),
  }
  const repository = {
    loadStageContext: vi.fn(async () => context),
    registerArtifactPointer: vi.fn(async () => {
      calls.push('pointer')
      return 'session-artifact-1'
    }),
    recordStageError: vi.fn(async () => {
      calls.push('error')
    }),
    recordStageOutput: vi.fn(async () => {}),
    persistStreamLog: vi.fn(async () => {}),
  }
  const transitionNodeStatus = vi.fn(async (_nodeId: string, status: string) => {
    calls.push(status)
  })
  const writeArtifact = vi.fn(async () => {
    calls.push('artifact')
    return artifactResult()
  })
  const prepareResult = vi.fn((_context, content: string) => ({ content }))
  const commitResult = vi.fn(async () => {
    calls.push('commit')
  })
  const runStageEffect = vi.fn(async () => {
    calls.push('effect')
  })
  const advancePipeline = vi.fn(async () => {
    calls.push('advance')
  })
  const scheduleMediaNarration = vi.fn(async () => {
    calls.push('media')
  })
  const createSession = vi.fn(async () => session)
  const runner = createStageRunner({
    repository,
    transitionNodeStatus,
    createSession,
    buildPrompt: vi.fn(() => '类型化阶段提示词'),
    writeArtifact,
    prepareResult,
    commitResult,
    runStageEffect,
    advancePipeline,
    scheduleMediaNarration,
  })
  return {
    calls,
    repository,
    transitionNodeStatus,
    session,
    writeArtifact,
    prepareResult,
    commitResult,
    runStageEffect,
    advancePipeline,
    scheduleMediaNarration,
    createSession,
    runner,
  }
}

describe('createStageRunner', () => {
  it('registers the final session bytes after close and commits the validated output', async () => {
    const harness = createHarness()

    await harness.runner('project-1', 'node-1', 'INGEST')

    expect(harness.calls).toEqual([
      'running',
      'run',
      'artifact',
      'commit',
      'effect',
      'close',
      'pointer',
      'success',
      'media',
      'advance',
    ])
    expect(harness.writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'node-1',
        content: '业务产物',
        validation: 'non-empty',
      })
    )
    expect(harness.session.run).toHaveBeenCalledWith({
      prompt: '类型化阶段提示词',
      tools: [],
      output: { kind: 'assistant-text' },
    })
    expect(harness.repository.persistStreamLog).toHaveBeenCalledTimes(1)
    expect(harness.runStageEffect).toHaveBeenCalledWith(context)
    expect(harness.repository.persistStreamLog).toHaveBeenCalledWith(
      'project-1',
      'node-1',
      'INGEST',
      '展示完成'
    )
    expect(harness.advancePipeline).toHaveBeenCalledWith('project-1', 'node-1')
    expect(harness.scheduleMediaNarration).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'node-1',
    })
  })

  it('passes the queue attempt id into the Director session', async () => {
    const harness = createHarness()

    await harness.runner('project-1', 'node-1', 'INGEST', 'queue-attempt-1')

    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      nodeId: 'node-1',
      attemptId: 'queue-attempt-1',
    }))
  })

  it('keeps INGEST successful when the asynchronous media queue is unavailable', async () => {
    const harness = createHarness()
    harness.scheduleMediaNarration.mockRejectedValueOnce(new Error('媒体队列不可用'))

    await expect(
      harness.runner('project-1', 'node-1', 'INGEST')
    ).resolves.toBeUndefined()

    expect(harness.transitionNodeStatus).toHaveBeenCalledWith('node-1', 'success')
    expect(harness.advancePipeline).toHaveBeenCalledWith('project-1', 'node-1')
    expect(harness.repository.recordStageError).not.toHaveBeenCalled()
  })

  it.each([
    ['INGEST', 'script-import', { kind: 'assistant-text' }],
    ['DIRECT', 'shot-split', { kind: 'assistant-text' }],
    ['SHOT_SPEC', 'shot-script', SHOT_SPEC_OUTPUT],
    ['FABRICATE', 'shot-codegen', FABRICATE_OUTPUT],
    ['ASSEMBLE', 'score', { kind: 'assistant-text' }],
    ['FINALIZE', 'export', { kind: 'assistant-text' }],
  ] as const)(
    'passes the explicit %s output policy to every invocation',
    async (stage, nodeType, output) => {
      const harness = createHarness()
      harness.repository.loadStageContext.mockResolvedValue({
        ...context,
        stage,
        nodeType,
      })

      await harness.runner('project-1', 'node-1', stage)

      expect(harness.session.run).toHaveBeenCalledWith(
        expect.objectContaining({ output })
      )
    }
  )

  it('keeps the session pointer and records failures without leaving running state', async () => {
    const harness = createHarness(
      vi.fn(async () => {
        throw new Error('模型失败')
      })
    )

    await expect(harness.runner('project-1', 'node-1', 'INGEST')).rejects.toThrow(
      '模型失败'
    )

    expect(harness.repository.registerArtifactPointer).toHaveBeenCalledOnce()
    expect(harness.repository.recordStageError).toHaveBeenCalledWith(
      'node-1',
      'INGEST',
      expect.any(Error)
    )
    expect(harness.calls).toEqual([
      'running',
      'run',
      'close',
      'pointer',
      'failed',
      'error',
    ])
    expect(harness.repository.persistStreamLog).toHaveBeenCalledTimes(1)
    expect(harness.advancePipeline).not.toHaveBeenCalled()
  })

  it('fails invalid persisted input before creating a model session', async () => {
    const harness = createHarness()
    const inputError = new Error('directorInput 无效')
    const createSession = vi.fn()
    const runner = createStageRunner({
      repository: harness.repository,
      transitionNodeStatus: harness.transitionNodeStatus,
      createSession,
      buildPrompt: vi.fn(() => {
        throw inputError
      }),
      writeArtifact: harness.writeArtifact,
      prepareResult: harness.prepareResult,
      commitResult: harness.commitResult,
      runStageEffect: harness.runStageEffect,
      advancePipeline: harness.advancePipeline,
    })

    await expect(runner('project-1', 'node-1', 'INGEST')).rejects.toBe(inputError)
    expect(createSession).not.toHaveBeenCalled()
    expect(harness.transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'failed',
    ])
  })

  it('persists a failed node and stage error when runtime context loading fails', async () => {
    const harness = createHarness()
    const createSession = vi.fn()
    harness.repository.loadStageContext.mockImplementation(() => {
      throw new Error('Director 节点必须为 pending')
    })
    const runner = createStageRunner({
      repository: harness.repository,
      transitionNodeStatus: harness.transitionNodeStatus,
      createSession,
      buildPrompt: vi.fn(() => '不会构建'),
      writeArtifact: harness.writeArtifact,
      prepareResult: harness.prepareResult,
      commitResult: harness.commitResult,
      runStageEffect: harness.runStageEffect,
      advancePipeline: harness.advancePipeline,
    })

    await expect(runner('project-1', 'node-1', 'INGEST')).rejects.toThrow('pending')
    expect(createSession).not.toHaveBeenCalled()
    expect(harness.transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'failed',
    ])
    expect(harness.repository.recordStageError).toHaveBeenCalledWith(
      'node-1',
      'INGEST',
      expect.any(Error)
    )
  })

  it('fails the stage when an application side effect cannot produce its real artifact', async () => {
    const harness = createHarness()
    harness.runStageEffect.mockRejectedValueOnce(new Error('TTS 失败'))

    await expect(harness.runner('project-1', 'node-1', 'INGEST')).rejects.toThrow(
      'TTS 失败'
    )

    expect(harness.calls).toEqual([
      'running',
      'run',
      'artifact',
      'commit',
      'close',
      'pointer',
      'failed',
      'error',
    ])
    expect(harness.transitionNodeStatus).not.toHaveBeenCalledWith('node-1', 'success')
    expect(harness.advancePipeline).not.toHaveBeenCalled()
  })

  it('projects provider pacing as a queue wait instead of a failed Director stage', async () => {
    const harness = createHarness()
    const wait = new ProviderDispatchWaitError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      funding: 'managed',
      retryAt: new Date('2026-07-30T05:02:41.400Z'),
      scopeKey: 'managed:stepfun',
      waitReason: 'pacing',
    })
    harness.runStageEffect.mockRejectedValueOnce(wait)

    await expect(
      harness.runner('project-1', 'node-1', 'ASSEMBLE', 'attempt-1')
    ).rejects.toBe(wait)

    expect(harness.transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
    ])
    expect(harness.repository.recordStageError).not.toHaveBeenCalled()
  })

  it('resumes only the committed subtitle side effect after a provider wait', async () => {
    const harness = createHarness()
    harness.repository.loadStageContext.mockResolvedValue({
      ...context,
      nodeType: 'shot-subtitle',
      stage: 'ASSEMBLE',
    })
    Object.assign(harness.repository, {
      shouldResumeCommittedEffect: vi.fn(async () => true),
    })

    await harness.runner('project-1', 'node-1', 'ASSEMBLE', 'attempt-2')

    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.writeArtifact).not.toHaveBeenCalled()
    expect(harness.commitResult).not.toHaveBeenCalled()
    expect(harness.runStageEffect).toHaveBeenCalledOnce()
    expect(harness.transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'success',
    ])
    expect(harness.advancePipeline).toHaveBeenCalledWith('project-1', 'node-1')
  })

  it('reuses the same FABRICATE session for at most two gate-feedback retries', async () => {
    const harness = createHarness()
    harness.repository.loadStageContext.mockResolvedValue({
      ...context,
      nodeType: 'shot-codegen',
      stage: 'FABRICATE',
    })
    harness.session.run
      .mockResolvedValueOnce(directorResult('<html>违规一</html>'))
      .mockResolvedValueOnce(directorResult('<html>违规二</html>'))
      .mockResolvedValueOnce(directorResult('<html>合格</html>'))
    harness.writeArtifact
      .mockImplementationOnce(async () => {
        harness.calls.push('artifact')
        throw new ArtifactValidationError([
          'set-interval@457: 禁止 setInterval 驱动动画',
        ])
      })
      .mockImplementationOnce(async () => {
        harness.calls.push('artifact')
        throw new ArtifactValidationError([
          'date-now@99: 禁止读取墙钟时间',
        ])
      })

    await harness.runner('project-1', 'node-1', 'FABRICATE')

    expect(harness.session.run).toHaveBeenCalledTimes(3)
    expect(harness.writeArtifact).toHaveBeenCalledTimes(3)
    expect(harness.session.run.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining('set-interval@457'),
        output: FABRICATE_OUTPUT,
      })
    )
    expect(harness.session.run.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining('date-now@99'),
        output: FABRICATE_OUTPUT,
      })
    )
    expect(harness.calls.filter((call) => call === 'commit')).toHaveLength(1)
    expect(harness.calls).toContain('success')
  })

  it('fails with the last violation detail after exhausting two feedback retries', async () => {
    const harness = createHarness()
    harness.repository.loadStageContext.mockResolvedValue({
      ...context,
      nodeType: 'shot-codegen',
      stage: 'FABRICATE',
    })
    harness.writeArtifact.mockImplementation(async () => {
      harness.calls.push('artifact')
      throw new ArtifactValidationError([
        'css-animation@88: 禁止 CSS animation',
      ])
    })

    await expect(
      harness.runner('project-1', 'node-1', 'FABRICATE')
    ).rejects.toThrow('自动重试 2 次后仍违规')

    expect(harness.session.run).toHaveBeenCalledTimes(3)
    expect(harness.repository.recordStageError).toHaveBeenCalledWith(
      'node-1',
      'FABRICATE',
      expect.objectContaining({
        message: expect.stringContaining('css-animation@88'),
      })
    )
    expect(harness.advancePipeline).not.toHaveBeenCalled()
  })

  it('retries SHOT_SPEC semantic validation before any invalid artifact is written', async () => {
    const harness = createHarness()
    harness.repository.loadStageContext.mockResolvedValue({
      ...context,
      nodeType: 'shot-script',
      stage: 'SHOT_SPEC',
    })
    harness.prepareResult.mockImplementationOnce(() => {
      throw new ArtifactValidationError(['shots.0.id 必须为 S002'])
    })

    await harness.runner('project-1', 'node-1', 'SHOT_SPEC')

    expect(harness.session.run).toHaveBeenCalledTimes(2)
    expect(harness.writeArtifact).toHaveBeenCalledTimes(1)
    expect(harness.session.run.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining('shots.0.id 必须为 S002'),
        output: SHOT_SPEC_OUTPUT,
      })
    )
  })

  it('does not retry network, normalization, or storage failures', async () => {
    const network = createHarness(
      vi.fn(async () => {
        throw new Error('网络失败')
      })
    )
    await expect(
      network.runner('project-1', 'node-1', 'FABRICATE')
    ).rejects.toThrow('网络失败')
    expect(network.session.run).toHaveBeenCalledOnce()

    const normalization = createHarness()
    normalization.prepareResult.mockImplementationOnce(() => {
      throw new Error('schema 归一失败')
    })
    await expect(
      normalization.runner('project-1', 'node-1', 'FABRICATE')
    ).rejects.toThrow('schema 归一失败')
    expect(normalization.session.run).toHaveBeenCalledOnce()
    expect(normalization.writeArtifact).not.toHaveBeenCalled()

    const storage = createHarness()
    storage.writeArtifact.mockRejectedValueOnce(new Error('存储失败'))
    await expect(
      storage.runner('project-1', 'node-1', 'FABRICATE')
    ).rejects.toThrow('存储失败')
    expect(storage.session.run).toHaveBeenCalledOnce()
  })
})
