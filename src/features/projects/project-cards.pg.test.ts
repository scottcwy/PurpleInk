import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  projectSources,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { loadProjectCardPage } from './project-cards'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000801'
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000802'
const SCRIPT_NEW_ID = '00000000-0000-4000-8000-000000000811'
const SCRIPT_OLD_ID = '00000000-0000-4000-8000-000000000812'
const AUDIO_ID = '00000000-0000-4000-8000-000000000813'
const WEBSITE_ID = '00000000-0000-4000-8000-000000000814'
const LEGACY_ID = '00000000-0000-4000-8000-000000000815'
const FOREIGN_ID = '00000000-0000-4000-8000-000000000816'

const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

describe('loadProjectCardPage', () => {
  beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
  beforeEach(async () => {
    await database.reset()
    await seed(database.db)
  })
  afterAll(async () => database.close())

  it('pages one kind by recency and reports per-kind counts', async () => {
    const page = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      kind: 'script',
      offset: 0,
      limit: 1,
    })
    expect(page.items.map((item) => item.id)).toEqual([SCRIPT_NEW_ID])
    expect(page.total).toBe(2)
    expect(page.kindCounts).toEqual({ script: 2, audio: 1, website: 1 })

    const next = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      kind: 'script',
      offset: 1,
      limit: 1,
    })
    expect(next.items.map((item) => item.id)).toEqual([SCRIPT_OLD_ID])
  })

  it('aggregates node status and shot count without loading graphs', async () => {
    const page = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      offset: 0,
      limit: 10,
    })
    const byId = new Map(page.items.map((item) => [item.id, item]))
    expect(byId.get(SCRIPT_NEW_ID)).toMatchObject({
      status: 'failed',
      shotCount: 2,
    })
    expect(byId.get(SCRIPT_OLD_ID)).toMatchObject({
      status: 'rendered',
      shotCount: 1,
    })
    expect(byId.get(AUDIO_ID)).toMatchObject({ status: 'generating' })
    expect(byId.get(WEBSITE_ID)).toMatchObject({
      status: 'recovering',
      shotCount: 0,
    })
  })

  it('projects source summaries per kind and never ships the full script', async () => {
    const page = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      offset: 0,
      limit: 10,
    })
    const byId = new Map(page.items.map((item) => [item.id, item]))
    expect(byId.get(WEBSITE_ID)?.sourceSummary).toBe('https://example.com/demo')
    expect(byId.get(AUDIO_ID)?.sourceSummary).toBe('产品录音.wav')
    const excerpt = byId.get(SCRIPT_NEW_ID)?.sourceSummary
    // 存储的文稿为 2 空格 + 200 个“长”；left(script, 80) 后 trim 剩 78 字，
    // 证明完整文稿没有下发。
    expect(excerpt).toBe('长'.repeat(78))
  })

  it('searches titles across kinds with escaped patterns', async () => {
    const page = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      q: '10%_进度',
      offset: 0,
      limit: 10,
    })
    expect(page.items.map((item) => item.id)).toEqual([AUDIO_ID])
    expect(page.total).toBe(1)
    expect(page.kindCounts).toEqual({ script: 0, audio: 1, website: 0 })
  })

  it('excludes legacy workflow versions and foreign workspaces', async () => {
    const page = await loadProjectCardPage(database.db, WORKSPACE_ID, {
      offset: 0,
      limit: 10,
    })
    const ids = page.items.map((item) => item.id)
    expect(ids).not.toContain(LEGACY_ID)
    expect(ids).not.toContain(FOREIGN_ID)
    expect(page.total).toBe(4)
  })
})

async function seed(db: Db): Promise<void> {
  await db.insert(workspaces).values([
    { id: WORKSPACE_ID, slug: 'cards-local', name: 'Cards Local' },
    { id: OTHER_WORKSPACE_ID, slug: 'cards-other', name: 'Cards Other' },
  ])
  const base = Date.parse('2026-07-30T00:00:00.000Z')
  await db.insert(projects).values([
    projectRow(WORKSPACE_ID, SCRIPT_NEW_ID, 'script', {
      title: '最新脚本项目',
      script: `  ${'长'.repeat(200)}  `,
      updatedAt: new Date(base + 4_000),
    }),
    projectRow(WORKSPACE_ID, SCRIPT_OLD_ID, 'script', {
      title: '较旧脚本项目',
      script: '旧文稿',
      updatedAt: new Date(base + 3_000),
    }),
    projectRow(WORKSPACE_ID, AUDIO_ID, 'audio', {
      title: '10%_进度周报录音',
      updatedAt: new Date(base + 2_000),
    }),
    projectRow(WORKSPACE_ID, WEBSITE_ID, 'website', {
      title: '官网介绍',
      updatedAt: new Date(base + 1_000),
    }),
    {
      ...projectRow(WORKSPACE_ID, LEGACY_ID, 'script', { title: '旧版项目' }),
      workflowVersion: 'legacy-version',
    },
    projectRow(OTHER_WORKSPACE_ID, FOREIGN_ID, 'script', {
      title: '别人工作区的项目',
    }),
  ])
  await db.insert(canvasNodes).values([
    // SCRIPT_NEW：两镜头，其一失败 → failed
    nodeRow(SCRIPT_NEW_ID, 'n1', 'shot-codegen', 'FABRICATE', 'succeeded'),
    nodeRow(SCRIPT_NEW_ID, 'n2', 'shot-codegen', 'FABRICATE', 'failed'),
    // SCRIPT_OLD：全部成功 → rendered
    nodeRow(SCRIPT_OLD_ID, 'n3', 'shot-codegen', 'FABRICATE', 'succeeded'),
    nodeRow(SCRIPT_OLD_ID, 'n4', 'script-import', 'INGEST', 'succeeded'),
    // AUDIO：排队中 → generating
    nodeRow(AUDIO_ID, 'n5', 'audio-transcribe', 'INGEST', 'queued'),
    nodeRow(WEBSITE_ID, 'n6', 'website-stage', 'INGEST', 'queued'),
  ])
  await db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: '00000000-0000-4000-8000-000000000821',
    projectId: AUDIO_ID,
    status: 'queued',
    executionEpoch: 0,
    workflowVersion: activeWorkflowVersionFor('audio'),
    fingerprint: 'c'.repeat(64),
  })
  await db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: '00000000-0000-4000-8000-000000000822',
    runId: '00000000-0000-4000-8000-000000000821',
    taskId: 'legacy.audio-transcribe',
    entityType: 'project',
    entityId: AUDIO_ID,
    attemptNo: 1,
    status: 'queued',
    fingerprint: 'd'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  await db.insert(projectSources).values([
    {
      workspaceId: WORKSPACE_ID,
      projectId: WEBSITE_ID,
      kind: 'website' as const,
      sourcePayload: {
        schemaVersion: 1,
        kind: 'website',
        url: 'https://example.com/demo',
        durationSec: 24,
        quality: 'standard',
        visualTheme: 'dark',
      },
      sourceFingerprint: 'a'.repeat(64),
    },
    {
      workspaceId: WORKSPACE_ID,
      projectId: AUDIO_ID,
      kind: 'audio' as const,
      sourcePayload: {
        schemaVersion: 1,
        kind: 'audio',
        storageKey: 'workspace/project/source-recording.wav',
        fileName: '产品录音.wav',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: 96_044,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
        visualTheme: 'light',
      },
      sourceFingerprint: 'b'.repeat(64),
    },
  ])
}

function projectRow(
  workspaceId: string,
  id: string,
  kind: 'script' | 'audio' | 'website',
  overrides: { title?: string; script?: string; updatedAt?: Date } = {},
) {
  return {
    workspaceId,
    id,
    title: overrides.title ?? `${kind} project`,
    script: overrides.script ?? '',
    workflowKind: kind,
    workflowVersion: activeWorkflowVersionFor(kind),
    exportSettings: { schemaVersion: 1 },
    ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  }
}

function nodeRow(
  projectId: string,
  logicalKey: string,
  type: string,
  stage: string,
  status: string,
) {
  return {
    workspaceId: WORKSPACE_ID,
    projectId,
    logicalKey,
    type,
    stage,
    status,
    data: { schemaVersion: 1 },
  }
}
