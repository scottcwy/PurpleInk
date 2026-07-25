import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type {
  DatabaseProvider,
  ProviderCredentialStore,
} from '@/features/credentials'
import {
  AI_TASK_KINDS,
  modelRoutes,
} from '@/lib/db/schema/index'

export type AiTaskKind = (typeof AI_TASK_KINDS)[number]

export interface ModelRoute {
  workspaceId: string
  aiTaskKind: AiTaskKind
  provider: string
  model: string
  revision: number
}

export interface ResolvedModelRoute extends ModelRoute {
  secret: string | null
}

const taskKinds = new Set<string>(AI_TASK_KINDS)

function assertTaskKind(value: string): asserts value is AiTaskKind {
  if (!taskKinds.has(value)) {
    throw new Error(`Unsupported AI task kind: ${value}`)
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function toRoute(row: typeof modelRoutes.$inferSelect): ModelRoute {
  assertTaskKind(row.aiTaskKind)
  return {
    workspaceId: row.workspaceId,
    aiTaskKind: row.aiTaskKind,
    provider: row.provider,
    model: row.model,
    revision: row.revision,
  }
}

export class PostgresModelRouteRepository {
  constructor(
    private readonly database: DatabaseProvider,
    private readonly credentials: ProviderCredentialStore,
  ) {}

  async save(input: {
    workspaceId: string
    aiTaskKind: AiTaskKind
    provider: string
    model: string
  }): Promise<ModelRoute> {
    assertTaskKind(input.aiTaskKind)
    const workspaceId = required(input.workspaceId, 'workspaceId')
    const provider = required(input.provider, 'provider')
    const model = required(input.model, 'model')
    const db = await this.database()
    const [row] = await db.insert(modelRoutes).values({
      workspaceId,
      aiTaskKind: input.aiTaskKind,
      provider,
      model,
    }).onConflictDoUpdate({
      target: [modelRoutes.workspaceId, modelRoutes.aiTaskKind],
      set: {
        provider,
        model,
        revision: sql`${modelRoutes.revision} + 1`,
        updatedAt: new Date(),
      },
    }).returning()
    if (!row) throw new Error('Model route save returned no row')
    return toRoute(row)
  }

  async find(
    workspaceIdInput: string,
    aiTaskKind: AiTaskKind,
  ): Promise<ModelRoute | null> {
    assertTaskKind(aiTaskKind)
    const workspaceId = required(workspaceIdInput, 'workspaceId')
    const db = await this.database()
    const [row] = await db.select().from(modelRoutes).where(and(
      eq(modelRoutes.workspaceId, workspaceId),
      eq(modelRoutes.aiTaskKind, aiTaskKind),
    )).limit(1)
    return row ? toRoute(row) : null
  }

  async resolve(
    workspaceId: string,
    aiTaskKind: AiTaskKind,
  ): Promise<ResolvedModelRoute | null> {
    const route = await this.find(workspaceId, aiTaskKind)
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
    aiTaskKind: AiTaskKind,
  ): Promise<boolean> {
    assertTaskKind(aiTaskKind)
    const workspaceId = required(workspaceIdInput, 'workspaceId')
    const db = await this.database()
    const rows = await db.delete(modelRoutes).where(and(
      eq(modelRoutes.workspaceId, workspaceId),
      eq(modelRoutes.aiTaskKind, aiTaskKind),
    )).returning({ id: modelRoutes.id })
    return rows.length > 0
  }
}
