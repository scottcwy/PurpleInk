import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { projects, workspaces } from '@/lib/db/schema/index'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import {
  PostgresProjectSourceRepository,
  ProjectSourceKindMismatchError,
} from './project-source-repository'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000701'
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000702'
const WEBSITE_PROJECT_ID = '00000000-0000-4000-8000-000000000711'
const AUDIO_PROJECT_ID = '00000000-0000-4000-8000-000000000712'
const SCRIPT_PROJECT_ID = '00000000-0000-4000-8000-000000000713'
const WEBSITE_FINGERPRINT = 'a'.repeat(64)
const AUDIO_FINGERPRINT = 'b'.repeat(64)

const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

describe('PostgresProjectSourceRepository', () => {
  beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
  beforeEach(async () => {
    await database.reset()
    await seedProjects(database.db)
  })
  afterAll(async () => database.close())

  it('creates and reads normalized sources inside the owning workspace only', async () => {
    const local = new PostgresProjectSourceRepository(
      database.db,
      WORKSPACE_ID,
    )
    const foreign = new PostgresProjectSourceRepository(
      database.db,
      OTHER_WORKSPACE_ID,
    )
    const created = await local.create({
      projectId: WEBSITE_PROJECT_ID,
      sourceFingerprint: WEBSITE_FINGERPRINT,
      sourcePayload: websiteSource('HTTPS://Example.COM:443/demo#panel'),
    })

    expect(created.sourcePayload).toMatchObject({
      kind: 'website',
      url: 'https://example.com/demo',
    })
    await expect(local.get(WEBSITE_PROJECT_ID)).resolves.toEqual(created)
    await expect(foreign.get(WEBSITE_PROJECT_ID)).resolves.toBeNull()
  })

  it('persists an audio storage reference without inventing an Artifact id', async () => {
    const repository = new PostgresProjectSourceRepository(
      database.db,
      WORKSPACE_ID,
    )
    const created = await repository.create({
      projectId: AUDIO_PROJECT_ID,
      sourceFingerprint: AUDIO_FINGERPRINT,
      sourcePayload: audioSource(),
    })

    expect(created.sourcePayload).toEqual(audioSource())
    expect(created.sourcePayload).not.toHaveProperty('audioArtifactId')
    expect(created.sourcePayload).not.toHaveProperty('audioBytes')
  })

  it('rejects mismatched kind and duplicate source writes', async () => {
    const repository = new PostgresProjectSourceRepository(
      database.db,
      WORKSPACE_ID,
    )
    await expect(
      repository.create({
        projectId: SCRIPT_PROJECT_ID,
        sourceFingerprint: AUDIO_FINGERPRINT,
        sourcePayload: audioSource(),
      }),
    ).rejects.toBeInstanceOf(ProjectSourceKindMismatchError)

    const input = {
      projectId: WEBSITE_PROJECT_ID,
      sourceFingerprint: WEBSITE_FINGERPRINT,
      sourcePayload: websiteSource('https://example.com'),
    }
    await repository.create(input)
    await expect(repository.create(input)).rejects.toThrow()
    await expect(repository.get(WEBSITE_PROJECT_ID)).resolves.toMatchObject({
      sourceFingerprint: WEBSITE_FINGERPRINT,
    })
  })

  it('cascades the source when its owning project is deleted', async () => {
    const repository = new PostgresProjectSourceRepository(
      database.db,
      WORKSPACE_ID,
    )
    await repository.create({
      projectId: WEBSITE_PROJECT_ID,
      sourceFingerprint: WEBSITE_FINGERPRINT,
      sourcePayload: websiteSource('https://example.com'),
    })

    await database.db
      .delete(projects)
      .where(
        and(
          eq(projects.workspaceId, WORKSPACE_ID),
          eq(projects.id, WEBSITE_PROJECT_ID),
        ),
      )

    await expect(repository.get(WEBSITE_PROJECT_ID)).resolves.toBeNull()
  })
})

function websiteSource(url: string) {
  return {
    schemaVersion: 1 as const,
    kind: 'website' as const,
    url,
    durationSec: 24,
    quality: 'standard' as const,
    visualTheme: 'dark' as const,
  }
}

function audioSource() {
  return {
    schemaVersion: 1 as const,
    kind: 'audio' as const,
    storageKey: 'workspace/project/source-recording.wav',
    fileName: '产品录音.wav',
    mimeType: 'audio/wav' as const,
    container: 'wav' as const,
    sizeBytes: 96_044,
    durationMs: 1_000,
    sampleRate: 48_000,
    sampleCount: 48_000,
    visualTheme: 'light' as const,
  }
}

async function seedProjects(db: Db): Promise<void> {
  await db.insert(workspaces).values([
    { id: WORKSPACE_ID, slug: 'source-local', name: 'Source Local' },
    { id: OTHER_WORKSPACE_ID, slug: 'source-other', name: 'Source Other' },
  ])
  await db.insert(projects).values([
    projectRow(WORKSPACE_ID, WEBSITE_PROJECT_ID, 'website'),
    projectRow(WORKSPACE_ID, AUDIO_PROJECT_ID, 'audio'),
    projectRow(WORKSPACE_ID, SCRIPT_PROJECT_ID, 'script'),
    projectRow(
      OTHER_WORKSPACE_ID,
      '00000000-0000-4000-8000-000000000714',
      'website',
    ),
  ])
}

function projectRow(
  workspaceId: string,
  id: string,
  kind: 'script' | 'audio' | 'website',
) {
  return {
    workspaceId,
    id,
    title: `${kind} project`,
    script: kind === 'script' ? '真实文稿' : '',
    workflowKind: kind,
    workflowVersion: activeWorkflowVersionFor(kind),
    exportSettings: { schemaVersion: 1 },
  }
}
