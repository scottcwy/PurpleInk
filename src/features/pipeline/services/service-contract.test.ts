import { readFile } from "node:fs/promises"

import { describe, expect, it, vi } from "vitest"

import {
  createExecutionContext,
  type ExecutionContextV1,
} from "../execution-context"
import type { ProgressSink } from "../progress/progress-sink"
import { CVC_TASK_IDS, type CvcTaskId } from "../contracts/task-ids"
import {
  ProjectTaskPayloadV1Schema,
  ShotTaskPayloadV1Schema,
} from "../contracts/task-payload"
import { TaskResultV1Schema } from "../contracts/task-result"
import { createProjectComposeService } from "./project-compose-service"
import {
  createProjectPlanService,
  projectPlanService,
} from "./project-plan-service"
import { createShotGenerateService } from "./shot-generate-service"
import { createShotMediaService } from "./shot-media-service"
import { createShotQaService } from "./shot-qa-service"
import { createShotRenderService } from "./shot-render-service"

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001"
const PROJECT_ID = "00000000-0000-4000-8000-000000000002"
const PIPELINE_RUN_ID = "00000000-0000-4000-8000-000000000003"
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000004"
const SHOT_ID = "00000000-0000-4000-8000-000000000005"
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000006"
const TRIGGER_RUN_ID = "run_n2_service_contract"
const FINGERPRINT = "f".repeat(64)
const CHECKPOINT_HASH = "c".repeat(64)
const WORKFLOW_VERSION = "cvc-workflow/v3-test"

type PortOutput = {
  artifactIds: string[]
  checkpointHash: string
}

type DomainPort = (
  context: ExecutionContextV1,
) => Promise<PortOutput>

type DomainService = {
  execute(context: ExecutionContextV1): Promise<unknown>
}

type ServiceCase = {
  label: string
  taskId: CvcTaskId
  scope: "project" | "shot"
  create: (port: DomainPort) => DomainService
}

const SERVICE_CASES: ServiceCase[] = [
  {
    label: "project plan",
    taskId: CVC_TASK_IDS[1],
    scope: "project",
    create: (projectPlanPort) =>
      createProjectPlanService({ projectPlanPort }),
  },
  {
    label: "shot generate",
    taskId: CVC_TASK_IDS[2],
    scope: "shot",
    create: (shotGeneratePort) =>
      createShotGenerateService({ shotGeneratePort }),
  },
  {
    label: "shot render",
    taskId: CVC_TASK_IDS[4],
    scope: "shot",
    create: (shotRenderPort) =>
      createShotRenderService({ shotRenderPort }),
  },
  {
    label: "shot QA",
    taskId: CVC_TASK_IDS[5],
    scope: "shot",
    create: (shotQaPort) => createShotQaService({ shotQaPort }),
  },
  {
    label: "project compose",
    taskId: CVC_TASK_IDS[6],
    scope: "project",
    create: (projectComposePort) =>
      createProjectComposeService({ projectComposePort }),
  },
]

function createContexts() {
  const controller = new AbortController()
  const progress = vi.fn<ProgressSink>(async () => undefined)
  const options = {
    triggerRunId: TRIGGER_RUN_ID,
    signal: controller.signal,
    progress,
  }
  const project = createExecutionContext({
    ...options,
    payload: ProjectTaskPayloadV1Schema.parse({
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      pipelineRunId: PIPELINE_RUN_ID,
      attemptId: ATTEMPT_ID,
      fingerprint: FINGERPRINT,
      workflowVersion: WORKFLOW_VERSION,
      entity: { type: "project", id: PROJECT_ID },
    }),
  })
  const shot = createExecutionContext({
    ...options,
    payload: ShotTaskPayloadV1Schema.parse({
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      pipelineRunId: PIPELINE_RUN_ID,
      attemptId: ATTEMPT_ID,
      shotId: SHOT_ID,
      fingerprint: FINGERPRINT,
      workflowVersion: WORKFLOW_VERSION,
      entity: { type: "shot", id: SHOT_ID },
    }),
  })

  return { controller, progress, project, shot }
}

function expectCompleteContext(
  received: ExecutionContextV1,
  expected: ExecutionContextV1,
  scope: "project" | "shot",
): void {
  expect(received.workspaceId).toBe(WORKSPACE_ID)
  expect(received.projectId).toBe(PROJECT_ID)
  expect(received.pipelineRunId).toBe(PIPELINE_RUN_ID)
  expect(received.triggerRunId).toBe(TRIGGER_RUN_ID)
  expect(received.attemptId).toBe(ATTEMPT_ID)
  expect(received.fingerprint).toBe(FINGERPRINT)
  expect(received.workflowVersion).toBe(WORKFLOW_VERSION)
  expect(received.shotId).toBe(scope === "shot" ? SHOT_ID : undefined)
  expect(received.signal).toBe(expected.signal)
  expect(received.progress).toBe(expected.progress)
}

function expectTaskResult(value: unknown, taskId: CvcTaskId): void {
  expect(TaskResultV1Schema.parse(value)).toEqual({
    schemaVersion: 1,
    taskId,
    pipelineRunId: PIPELINE_RUN_ID,
    attemptId: ATTEMPT_ID,
    outcome: "completed",
    artifactIds: [ARTIFACT_ID],
    checkpointHash: CHECKPOINT_HASH,
  })
}

describe("ExecutionContextV1", () => {
  it("keeps trusted scope, cancellation, and progress identities intact", () => {
    const { controller, progress, shot } = createContexts()

    expectCompleteContext(shot, shot, "shot")
    expect(shot.signal).toBe(controller.signal)
    expect(shot.progress).toBe(progress)

    controller.abort()
    expect(shot.signal.aborted).toBe(true)
  })
})

describe("pipeline application service ports", () => {
  it.each(SERVICE_CASES)(
    "$label calls only its domain port once and maps its result",
    async ({ taskId, scope, create }) => {
      const contexts = createContexts()
      const context = contexts[scope]
      const port = vi.fn<DomainPort>(async () => ({
        artifactIds: [ARTIFACT_ID],
        checkpointHash: CHECKPOINT_HASH,
      }))
      const service = create(port)

      const result = await service.execute(context)

      expect(port).toHaveBeenCalledOnce()
      const received = port.mock.calls[0]?.[0]
      expect(received).toBeDefined()
      expectCompleteContext(received!, context, scope)
      expectTaskResult(result, taskId)
      expect(contexts.progress).toHaveBeenNthCalledWith(1, {
        phase: "started",
        progress: 0,
      })
      expect(contexts.progress).toHaveBeenNthCalledWith(2, {
        phase: "completed",
        progress: 100,
      })
    },
  )

  it("uses a plain speech/media port for shot media without an Agent runtime", async () => {
    const { shot } = createContexts()
    const speechMediaPort = vi.fn<DomainPort>(async () => ({
      artifactIds: [ARTIFACT_ID],
      checkpointHash: CHECKPOINT_HASH,
    }))
    const service = createShotMediaService({ speechMediaPort })

    const result = await service.execute(shot)

    expect(speechMediaPort).toHaveBeenCalledOnce()
    const received = speechMediaPort.mock.calls[0]?.[0]
    expect(received).toBeDefined()
    expectCompleteContext(received!, shot, "shot")
    expectTaskResult(result, CVC_TASK_IDS[3])

    const source = await readFile(
      new URL("./shot-media-service.ts", import.meta.url),
      "utf8",
    )
    expect(source).not.toMatch(
      /@earendil-works\/pi-agent-core|@openai\/agents|new\s+Agent\s*\(/,
    )
  })

  it("fails an unbound domain adapter explicitly without fake completion", async () => {
    const { progress, project } = createContexts()

    await expect(projectPlanService.execute(project)).rejects.toMatchObject({
      failure: { code: "DOMAIN_ADAPTER_PENDING", retryable: false },
    })
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual([
      "started",
      "failed",
    ])
  })

  it("rejects storage details returned across the port boundary", async () => {
    const { project } = createContexts()
    const projectPlanPort = vi.fn(async () => ({
      artifactIds: [ARTIFACT_ID],
      checkpointHash: CHECKPOINT_HASH,
      outputKey: "private/render.mp4",
    }))
    const service = createProjectPlanService({
      projectPlanPort: projectPlanPort as DomainPort,
    })

    await expect(service.execute(project)).rejects.toThrow()
  })

  it("never emits completed after cancellation", async () => {
    const { controller, progress, shot } = createContexts()
    const shotRenderPort = vi.fn<DomainPort>(async () => {
      controller.abort()
      return {
        artifactIds: [ARTIFACT_ID],
        checkpointHash: CHECKPOINT_HASH,
      }
    })
    const service = createShotRenderService({ shotRenderPort })

    await expect(service.execute(shot)).rejects.toThrow()
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual([
      "started",
      "cancelled",
    ])
  })
})
