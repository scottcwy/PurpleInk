import { describe, expect, it } from "vitest"

import {
  aiQueue,
  composeQueue,
  mediaQueue,
  renderQueue,
} from "../../../../trigger/queues"
import {
  parsePipelineProgressEvent,
  pipelineProgressStream,
} from "../../../../trigger/streams"
import { NODE_STATUSES } from "@/lib/db/schema/canvas"
import {
  ATTEMPT_STATUSES,
  RUN_STATUSES,
} from "@/lib/db/schema/execution"
import { TaskFailureError, TaskFailureV1Schema } from "./failure"
import { SafeProgressEventV1Schema } from "./progress"
import {
  NODE_EXECUTION_STATUSES,
  PIPELINE_RUN_STATUSES,
  TASK_ATTEMPT_STATUSES,
} from "./status"
import { CVC_TASK_IDS } from "./task-ids"
import { TaskPayloadV1Schema } from "./task-payload"
import { TaskResultV1Schema } from "./task-result"
import { buildTaskTags } from "./tags"

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001"
const PROJECT_ID = "00000000-0000-4000-8000-000000000002"
const PIPELINE_RUN_ID = "00000000-0000-4000-8000-000000000003"
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000004"
const SHOT_ID = "00000000-0000-4000-8000-000000000005"
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000006"
const LETTERED_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const EXPECTED_TASK_IDS = [
  "cvc.pipeline.run",
  "cvc.project.plan",
  "cvc.shot.generate",
  "cvc.shot.media",
  "cvc.shot.render",
  "cvc.shot.qa",
  "cvc.project.compose",
] as const

const EXPECTED_PHASES = [
  "queued",
  "started",
  "checkpoint",
  "completed",
  "failed",
  "cancelled",
] as const

function basePayload() {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    pipelineRunId: PIPELINE_RUN_ID,
    attemptId: ATTEMPT_ID,
    fingerprint: "a".repeat(64),
    workflowVersion: "cvc-workflow/v3",
  }
}

function safeProgress(
  phase: (typeof EXPECTED_PHASES)[number] = "started",
) {
  return {
    schemaVersion: 1,
    taskId: "cvc.project.plan",
    pipelineRunId: PIPELINE_RUN_ID,
    attemptId: ATTEMPT_ID,
    phase,
    progress: 50,
    issueCode: "PIPELINE_TASK_PROGRESS",
    userMessage: "正在处理项目",
  }
}

describe("Trigger task and queue locks", () => {
  it("locks the exact unique seven task IDs", () => {
    expect(CVC_TASK_IDS).toEqual(EXPECTED_TASK_IDS)
    expect(new Set(CVC_TASK_IDS).size).toBe(EXPECTED_TASK_IDS.length)
  })

  it("locks the exact four static queues", () => {
    const queues = [aiQueue, renderQueue, mediaQueue, composeQueue]
    expect(
      queues.map(({ name, concurrencyLimit }) => ({
        name,
        concurrencyLimit,
      })),
    ).toEqual([
      { name: "cvc-ai", concurrencyLimit: 2 },
      { name: "cvc-render", concurrencyLimit: 1 },
      { name: "cvc-media", concurrencyLimit: 2 },
      { name: "cvc-compose", concurrencyLimit: 1 },
    ])
    expect(new Set(queues.map(({ name }) => name)).size).toBe(4)
  })
})

describe("Trigger task tags", () => {
  const tagInput = {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    pipelineRunId: PIPELINE_RUN_ID,
  }

  it("builds exact UUID-backed project and shot tags", () => {
    expect(buildTaskTags(tagInput)).toEqual([
      `workspace:${WORKSPACE_ID}`,
      `project:${PROJECT_ID}`,
      `pipeline:${PIPELINE_RUN_ID}`,
    ])
    expect(buildTaskTags({ ...tagInput, shotId: SHOT_ID })).toEqual([
      `workspace:${WORKSPACE_ID}`,
      `project:${PROJECT_ID}`,
      `pipeline:${PIPELINE_RUN_ID}`,
      `shot:${SHOT_ID}`,
    ])
  })

  it("rejects an invalid UUID in every tag position", () => {
    for (const key of [
      "workspaceId",
      "projectId",
      "pipelineRunId",
      "shotId",
    ] as const) {
      expect(() =>
        buildTaskTags({ ...tagInput, shotId: SHOT_ID, [key]: "not-a-uuid" }),
      ).toThrow()
    }
  })

  it("canonicalizes UUID-backed tags to lowercase", () => {
    expect(
      buildTaskTags({
        workspaceId: LETTERED_ID.toUpperCase(),
        projectId: PROJECT_ID,
        pipelineRunId: PIPELINE_RUN_ID,
      })[0],
    ).toBe(`workspace:${LETTERED_ID}`)
  })
})

describe("safe progress contract", () => {
  it("accepts only the six phases and bounded safe fields", () => {
    for (const phase of EXPECTED_PHASES) {
      expect(SafeProgressEventV1Schema.parse(safeProgress(phase)).phase).toBe(
        phase,
      )
    }
    expect(
      SafeProgressEventV1Schema.parse({
        ...safeProgress(),
        progress: 100,
        userMessage: "界".repeat(240),
      }).progress,
    ).toBe(100)
    expect(pipelineProgressStream.id).toBe("cvc.pipeline.progress.v1")
    expect(parsePipelineProgressEvent(safeProgress())).toEqual(safeProgress())
  })

  it.each([-1, 0.5, 101])("rejects invalid progress %s", (progress) => {
    expect(() =>
      SafeProgressEventV1Schema.parse({ ...safeProgress(), progress }),
    ).toThrow()
  })
})

describe("safe progress redaction", () => {
  it("rejects unstable codes, oversized messages, and unsafe fields", () => {
    expect(() =>
      SafeProgressEventV1Schema.parse({
        ...safeProgress(),
        issueCode: "unstable code",
      }),
    ).toThrow()
    expect(() =>
      SafeProgressEventV1Schema.parse({
        ...safeProgress(),
        userMessage: "x".repeat(241),
      }),
    ).toThrow()

    for (const field of [
      "rawDelta",
      "reasoning",
      "apiKey",
      "storagePath",
    ] as const) {
      expect(() =>
        SafeProgressEventV1Schema.parse({
          ...safeProgress(),
          [field]: "forbidden",
        }),
      ).toThrow()
    }
  })
})

describe("pipeline status locks", () => {
  it("locks all three execution status sets", () => {
    expect(NODE_EXECUTION_STATUSES).toEqual([
      "idle",
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "stale",
    ])
    expect(PIPELINE_RUN_STATUSES).toEqual([
      "triggering",
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ])
    expect(TASK_ATTEMPT_STATUSES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "superseded",
    ])
    expect(NODE_EXECUTION_STATUSES).toEqual(NODE_STATUSES)
    expect(PIPELINE_RUN_STATUSES).toEqual(RUN_STATUSES)
    expect(TASK_ATTEMPT_STATUSES).toEqual(ATTEMPT_STATUSES)
  })
})

describe("task schema parse", () => {
  it("parses minimal project and shot payloads", () => {
    const project = TaskPayloadV1Schema.parse({
      ...basePayload(),
      entity: { type: "project", id: PROJECT_ID },
    })
    const shot = TaskPayloadV1Schema.parse({
      ...basePayload(),
      entity: { type: "shot", id: SHOT_ID },
      shotId: SHOT_ID,
    })
    expect(project.entity).toEqual({ type: "project", id: PROJECT_ID })
    expect(shot).toMatchObject({ entity: { type: "shot" }, shotId: SHOT_ID })
    expect(() =>
      TaskPayloadV1Schema.parse({
        ...basePayload(),
        entity: { type: "project", id: SHOT_ID },
      }),
    ).toThrow()
    expect(() =>
      TaskPayloadV1Schema.parse({
        ...basePayload(),
        entity: { type: "shot", id: SHOT_ID },
        shotId: PROJECT_ID,
      }),
    ).toThrow()
  })

  it("parses minimal result and typed failure contracts", () => {
    expect(
      TaskResultV1Schema.parse({
        schemaVersion: 1,
        taskId: "cvc.project.plan",
        pipelineRunId: PIPELINE_RUN_ID,
        attemptId: ATTEMPT_ID,
        outcome: "completed",
        artifactIds: [ARTIFACT_ID],
        checkpointHash: "b".repeat(64),
      }),
    ).toMatchObject({ outcome: "completed", artifactIds: [ARTIFACT_ID] })
    expect(
      TaskFailureV1Schema.parse({
        schemaVersion: 1,
        code: "STALE_ATTEMPT",
        userMessage: "当前执行已过期",
        retryable: false,
      }),
    ).toMatchObject({ code: "STALE_ATTEMPT", retryable: false })
    expect(
      new TaskFailureError({
        schemaVersion: 1,
        code: "STALE_ATTEMPT",
        userMessage: "当前执行已过期",
        retryable: false,
      }).failure.code,
    ).toBe("STALE_ATTEMPT")
  })
})
