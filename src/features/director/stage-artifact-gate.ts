import 'server-only'
import { createHash } from 'node:crypto'
import type { DirectorSession, DirectorTool } from './pi-session'
import type { DirectorOutputPolicy } from './pi-output'
import type { DirectorStageContext } from './runtime-repository'
import type { PreparedStageResult } from './stage-result'
import { createCheckDeterminismTool } from './tools/check-determinism'
import { createValidateShotPlanTool } from './tools/validate-shot-plan'
import {
  ArtifactValidationError,
  type ArtifactCommitResult,
  type WriteArtifactInput,
} from './tools/write-artifact'
import { buildFabricateRetryPrompt } from './prompts/fabricate'
import { buildShotSpecRetryPrompt } from './prompts/shot-spec'
import type { PipelineStage } from './types'

/**
 * 阶段产物的生成与门禁重试。
 *
 * 与 stage-runner 的职责分界：runner 负责节点状态机、会话生命周期与下游推进；
 * 本模块只负责「让模型产出一个能通过产物门禁的内容」，包括按门禁错误回喂重试。
 */

export const MAX_GATE_RETRIES = 2

const STAGE_OUTPUT: Record<PipelineStage, DirectorOutputPolicy> = {
  INGEST: { kind: 'assistant-text' },
  DIRECT: { kind: 'assistant-text' },
  SHOT_SPEC: {
    kind: 'validated-tool-argument',
    toolName: 'validate_shot_plan',
    argumentKey: 'shotPlan',
  },
  FABRICATE: {
    kind: 'validated-tool-argument',
    toolName: 'check_determinism',
    argumentKey: 'source',
  },
  ASSEMBLE: { kind: 'assistant-text' },
  FINALIZE: { kind: 'assistant-text' },
}

export interface ValidatedArtifactInput {
  stage: PipelineStage
  context: DirectorStageContext
  session: DirectorSession
  initialPrompt: string
  prepareResult: (
    context: DirectorStageContext,
    rawContent: string
  ) => PreparedStageResult | Promise<PreparedStageResult>
  writeArtifact: (input: WriteArtifactInput) => Promise<ArtifactCommitResult>
}

export interface ValidatedArtifact {
  displayText: string
  prepared: PreparedStageResult
  artifact: ArtifactCommitResult
}

export async function generateValidatedArtifact(
  input: ValidatedArtifactInput
): Promise<ValidatedArtifact> {
  let prompt = input.initialPrompt
  let retries = 0
  while (true) {
    const result = await input.session.run({
      prompt,
      tools: toolsForStage(input.stage),
      output: STAGE_OUTPUT[input.stage],
    })
    const prepared = await input.prepareResult(
      input.context,
      result.artifactContent
    )
    try {
      const artifact = await input.writeArtifact(
        outputArtifact(input.context, prepared.content)
      )
      return { displayText: result.displayText, prepared, artifact }
    } catch (error) {
      if (
        !(error instanceof ArtifactValidationError) ||
        !isFeedbackStage(input.stage)
      ) {
        throw error
      }
      if (retries >= MAX_GATE_RETRIES) throw exhaustedGateError(error)
      retries += 1
      prompt = buildGateRetryPrompt(input.stage, retries, error.errors)
    }
  }
}

function isFeedbackStage(
  stage: PipelineStage
): stage is 'SHOT_SPEC' | 'FABRICATE' {
  return stage === 'SHOT_SPEC' || stage === 'FABRICATE'
}

function buildGateRetryPrompt(
  stage: 'SHOT_SPEC' | 'FABRICATE',
  retry: number,
  errors: string[]
): string {
  const input = { retry, maxRetries: MAX_GATE_RETRIES, errors }
  return stage === 'FABRICATE'
    ? buildFabricateRetryPrompt(input)
    : buildShotSpecRetryPrompt(input)
}

function exhaustedGateError(
  error: ArtifactValidationError
): ArtifactValidationError {
  const exhausted = new ArtifactValidationError(error.errors)
  exhausted.message =
    `产物校验失败（自动重试 ${MAX_GATE_RETRIES} 次后仍违规）：` +
    error.errors.join('；')
  return exhausted
}

function toolsForStage(stage: PipelineStage): readonly DirectorTool[] {
  if (stage === 'SHOT_SPEC') return [createValidateShotPlanTool()]
  if (stage === 'FABRICATE') return [createCheckDeterminismTool()]
  return []
}

function outputArtifact(
  context: DirectorStageContext,
  content: string
): WriteArtifactInput {
  const digest = createHash('sha256').update(content).digest('hex')
  const slug = context.stage.toLowerCase().replaceAll('_', '-')
  const extension =
    context.stage === 'SHOT_SPEC'
      ? 'json'
      : context.stage === 'FABRICATE'
        ? 'html'
        : 'txt'
  const validation =
    context.stage === 'SHOT_SPEC'
      ? 'shot-plan'
      : context.stage === 'FABRICATE'
        ? 'deterministic-html'
        : 'non-empty'
  return {
    projectId: context.projectId,
    nodeId: context.nodeId,
    kind: `director-${slug}`,
    key: `director/${context.projectId}/${context.nodeId}/${slug}-${digest}.${extension}`,
    content,
    validation,
  }
}
