import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type {
  DatabaseProvider,
  ProviderCredentialStore,
} from '@/features/credentials'
import {
  MEDIA_TASK_KINDS,
  mediaRoutes,
} from '@/lib/db/schema/index'

export type MediaTaskKind = (typeof MEDIA_TASK_KINDS)[number]

export interface MediaRoute {
  workspaceId: string
  mediaTaskKind: MediaTaskKind
  provider: string
  model: string
  revision: number
}

export interface ResolvedMediaRoute extends MediaRoute {
  secret: string | null
}

const taskKinds = new Set<string>(MEDIA_TASK_KINDS)

function assertTaskKind(value: string): asserts value is MediaTaskKind {
  if (!taskKinds.has(value)) {
    throw new Error(`Unsupported media task kind: ${value}`)
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function toRoute(row: typeof mediaRoutes.$inferSelect): MediaRoute {
  assertTaskKind(row.mediaTaskKind)
  return {
    workspaceId: row.workspaceId,
    mediaTaskKind: row.mediaTaskKind,
    provider: row.provider,
    model: row.model,
    revision: row.revision,
  }
}

export class PostgresMediaRouteRepository {
  constructor(
    private readonly database: DatabaseProvider,
    private readonly credentials: ProviderCredentialStore,
  ) {}

  async save(input: {
    workspaceId: string
    mediaTaskKind: MediaTaskKind
    provider: string
    model: string
  }): Promise<MediaRoute> {
    assertTaskKind(input.mediaTaskKind)
    const workspaceId = required(input.workspaceId, 'workspaceId')
    const provider = required(input.provider, 'provider')
    const model = required(input.model, 'model')
    const db = await this.database()
    const [row] = await db.insert(mediaRoutes).values({
      workspaceId,
      mediaTaskKind: input.mediaTaskKind,
      provider,
      model,
    }).onConflictDoUpdate({
      target: [mediaRoutes.workspaceId, mediaRoutes.mediaTaskKind],
      set: {
        provider,
        model,
        revision: sql`${mediaRoutes.revision} + 1`,
        updatedAt: new Date(),
      },
    }).returning()
    if (!row) throw new Error('Media route save returned no row')
    return toRoute(row)
  }

  async find(
    workspaceIdInput: string,
    mediaTaskKind: MediaTaskKind,
  ): Promise<MediaRoute | null> {
    assertTaskKind(mediaTaskKind)
    const workspaceId = required(workspaceIdInput, 'workspaceId')
    const db = await this.database()
    const [row] = await db.select().from(mediaRoutes).where(and(
      eq(mediaRoutes.workspaceId, workspaceId),
      eq(mediaRoutes.mediaTaskKind, mediaTaskKind),
    )).limit(1)
    return row ? toRoute(row) : null
  }

  async resolve(
    workspaceId: string,
    mediaTaskKind: MediaTaskKind,
  ): Promise<ResolvedMediaRoute | null> {
    const route = await this.find(workspaceId, mediaTaskKind)
    if (!route) return null
    return {
      ...route,
      secret: await this.credentials.loadSecret(
        route.workspaceId,
        route.provider,
      ),
    }
  }

  async remove(
    workspaceIdInput: string,
    mediaTaskKind: MediaTaskKind,
  ): Promise<boolean> {
    assertTaskKind(mediaTaskKind)
    const workspaceId = required(workspaceIdInput, 'workspaceId')
    const db = await this.database()
    const rows = await db.delete(mediaRoutes).where(and(
      eq(mediaRoutes.workspaceId, workspaceId),
      eq(mediaRoutes.mediaTaskKind, mediaTaskKind),
    )).returning({ id: mediaRoutes.id })
    return rows.length > 0
  }
}
