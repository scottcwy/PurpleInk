import 'server-only'
import { materializeShotLanes } from '@/features/canvas'
import type { ArtifactCommitResult } from './tools/write-artifact'
import type { DirectorStageContext } from './runtime-repository'
import type { PreparedStageResult } from './stage-result'

export interface StageResultRepository {
  recordStageOutput(
    nodeId: string,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult,
    signal?: AbortSignal,
  ): Promise<void>
}

/**
 * 提交已验证阶段结果产生的应用状态。
 *
 * 模型只提供候选内容；DAG 物化和 renderSpec 都由可信应用层执行。
 */
export async function commitStageResult(
  repository: StageResultRepository,
  context: DirectorStageContext,
  result: PreparedStageResult,
  artifact: ArtifactCommitResult,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  await repository.recordStageOutput(context.nodeId, result, artifact, signal)
  signal?.throwIfAborted()
  if (result.ingestShots) {
    await materializeShotLanes(context.projectId, result.ingestShots)
  }
}
