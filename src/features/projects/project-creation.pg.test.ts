import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canvasEdges,
  canvasNodes,
  projectSources,
  projects,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { createProjectWithSource } from './project-creation'
import { parseProjectSourcePayload } from './project-source'
import { buildProjectTopology } from './project-topology'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const FINGERPRINT = 'a'.repeat(64)
let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
}, 60_000)

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'project-create',
    name: 'Project Create',
  })
})

afterAll(async () => {
  if (database) await database.close()
})

describe('createProjectWithSource', () => {
  it.each([
    {
      name: 'script',
      source: {
        schemaVersion: 1 as const,
        kind: 'script' as const,
        script: '真实文稿',
        visualTheme: 'dark' as const,
      },
      expectedScript: '真实文稿',
    },
    {
      name: 'audio',
      source: {
        schemaVersion: 1 as const,
        kind: 'audio' as const,
        storageKey: 'project-sources/workspace/project/source.wav',
        fileName: '录音.wav',
        mimeType: 'audio/wav' as const,
        container: 'wav' as const,
        sizeBytes: 96_044,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
        visualTheme: 'light' as const,
      },
      expectedScript: '',
    },
    {
      name: 'website',
      source: {
        schemaVersion: 1 as const,
        kind: 'website' as const,
        url: 'https://example.com/demo',
        durationSec: 24,
        quality: 'standard' as const,
        visualTheme: 'dark' as const,
      },
      expectedScript: '',
    },
  ])('atomically materializes the $name project, source and topology', async ({
    source: rawSource,
    expectedScript,
  }) => {
    const source = parseProjectSourcePayload(rawSource)
    const topology = buildProjectTopology(source)
    const result = await createProjectWithSource(
      {
        title: `创建 ${source.kind}`,
        source,
        sourceFingerprint: FINGERPRINT,
      },
      {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        createId: randomUUID,
      },
    )

    const [project] = await database.db.select().from(projects)
    const [persistedSource] = await database.db.select().from(projectSources)
    const nodes = await database.db.select().from(canvasNodes)
    const edges = await database.db.select().from(canvasEdges)

    expect(result.project).toMatchObject({
      id: project?.id,
      kind: source.kind,
      script: expectedScript,
    })
    expect(project).toMatchObject({
      workflowKind: source.kind,
      workflowVersion: activeWorkflowVersionFor(source.kind),
      script: expectedScript,
      exportSettings: {
        schemaVersion: 1,
        settings: { resolutionPreset: '1920x1080' },
      },
    })
    expect(persistedSource).toMatchObject({
      projectId: project?.id,
      kind: source.kind,
      sourceFingerprint: FINGERPRINT,
    })
    expect(nodes).toHaveLength(topology.nodes.length)
    expect(edges).toHaveLength(topology.edges.length)
    expect(result.entryNodeId).toBe(
      nodes.find(({ logicalKey }) => logicalKey === topology.entryLogicalKey)?.id,
    )
  })

  it('rolls back project and source when initial topology insertion fails', async () => {
    const duplicateId = '30000000-0000-4000-8000-000000000001'
    const source = parseProjectSourcePayload({
      schemaVersion: 1,
      kind: 'script',
      script: '事务回滚验证',
      visualTheme: 'dark',
    })

    await expect(
      createProjectWithSource(
        {
          title: '不能留下半成品',
          source,
          sourceFingerprint: FINGERPRINT,
        },
        {
          database: database.db,
          workspaceId: WORKSPACE_ID,
          // 多个拓扑节点拿到相同主键，确保失败发生在 project/source 写入之后。
          createId: () => duplicateId,
        },
      ),
    ).rejects.toThrow()

    expect(await database.db.select().from(projects)).toHaveLength(0)
    expect(await database.db.select().from(projectSources)).toHaveLength(0)
    expect(await database.db.select().from(canvasNodes)).toHaveLength(0)
  })

  it('returns one website project for concurrent retries with the same creation key', async () => {
    const source = parseProjectSourcePayload({
      schemaVersion: 1,
      kind: 'website',
      url: 'https://example.com/demo',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })
    const input = {
      title: '幂等网站项目',
      source,
      sourceFingerprint: FINGERPRINT,
      idempotency: {
        key: '10000000-0000-4000-8000-000000000001',
        requestFingerprint: 'b'.repeat(64),
      },
    } as Parameters<typeof createProjectWithSource>[0] & {
      idempotency: { key: string; requestFingerprint: string }
    }

    const [first, second] = await Promise.all([
      createProjectWithSource(input, {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        createId: randomUUID,
      }),
      createProjectWithSource(input, {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        createId: randomUUID,
      }),
    ])

    expect(first.project.id).toBe(second.project.id)
    expect([first.reused, second.reused].sort()).toEqual([false, true])
    expect(await database.db.select().from(projects)).toHaveLength(1)
    expect(await database.db.select().from(projectSources)).toHaveLength(1)
    expect(await database.db.select().from(canvasNodes)).toHaveLength(6)
  })

  it('rejects reusing a creation key for a different canonical request', async () => {
    const source = parseProjectSourcePayload({
      schemaVersion: 1,
      kind: 'website',
      url: 'https://example.com/demo',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })
    const base = {
      title: '幂等网站项目',
      source,
      sourceFingerprint: FINGERPRINT,
      idempotency: {
        key: '10000000-0000-4000-8000-000000000002',
        requestFingerprint: 'c'.repeat(64),
      },
    } as Parameters<typeof createProjectWithSource>[0] & {
      idempotency: { key: string; requestFingerprint: string }
    }
    await createProjectWithSource(base, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
    })

    await expect(createProjectWithSource({
      ...base,
      idempotency: {
        ...base.idempotency!,
        requestFingerprint: 'd'.repeat(64),
      },
    }, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
    })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    })
  })
})
