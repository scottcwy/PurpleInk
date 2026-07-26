import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  audioAllocationSchema,
  audioManifestSchema,
} from '@/features/director/schemas/ingest'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import {
  assembleTrustedMediaPlan,
  type ExportBlockingIssue,
  type MediaAssemblyPlan,
} from './media-assembly'

interface AssemblyNode {
  nodeId: string
  type: string
  status: string
  laneKey: string | null
}

interface LoadInput {
  database: Db
  storage: StorageAdapter
  projectId: string
  nodes: AssemblyNode[]
  targetResolution: { width: number; height: number }
  musicKey: string | null
}

export interface LoadedMediaAssembly {
  plan: MediaAssemblyPlan | null
  blockingIssues: ExportBlockingIssue[]
  narrationReadyCount: number
  subtitleReadyCount: number
  requiredShotCount: number
}

const subtitleLineageSchema = z
  .object({
    shotId: z.string().min(1),
    sourceAudioArtifactId: z.string().min(1),
    sourceAudioKey: z.string().min(1),
  })
  .passthrough()

export async function loadMediaAssembly(
  input: LoadInput
): Promise<LoadedMediaAssembly> {
  const rows = await input.database
    .select({
      artifactId: artifacts.id,
      aggregateId: artifacts.aggregateId,
      kind: artifacts.kind,
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
      version: artifacts.version,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(artifacts.projectId, input.projectId),
        eq(artifacts.aggregateType, 'node')
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
  const ingestNode = input.nodes.find((node) => node.type === 'script-import')
  const ingestArtifact = ingestNode
    ? latest(rows, ingestNode.nodeId, 'director-ingest')
    : undefined
  if (!ingestArtifact) {
    return blocked(input.nodes, 'artifact-missing')
  }

  const ingest = await readJsonArtifact(input.storage, ingestArtifact)
  if (ingest.status !== 'ok') {
    return blocked(
      input.nodes,
      ingest.status === 'missing' ? 'artifact-missing' : 'artifact-invalid'
    )
  }
  const parsedIngest = z
    .object({
      audioManifest: audioManifestSchema,
      audioAllocation: audioAllocationSchema,
    })
    .passthrough()
    .safeParse(ingest.value)
  if (!parsedIngest.success) {
    return blocked(input.nodes, 'artifact-invalid')
  }

  const subtitleTracks: Record<
    string,
    z.infer<typeof subtitleLineageSchema>
  > = {}
  const storageIssues: ExportBlockingIssue[] = []
  for (const node of input.nodes.filter(
    (candidate) => candidate.type === 'shot-subtitle'
  )) {
    const artifact = latest(rows, node.nodeId, 'subtitle-track')
    if (!artifact) continue
    const loaded = await readJsonArtifact(input.storage, artifact)
    if (loaded.status !== 'ok') {
      storageIssues.push({
        laneKey: node.laneKey,
        kind: 'subtitle',
        code:
          loaded.status === 'missing'
            ? 'artifact-missing'
            : 'artifact-invalid',
      })
      continue
    }
    const parsed = subtitleLineageSchema.safeParse(loaded.value)
    if (parsed.success) subtitleTracks[artifact.artifactId] = parsed.data
  }

  const result = assembleTrustedMediaPlan({
    nodes: input.nodes.flatMap((node) =>
      node.laneKey ? [{ ...node, laneKey: node.laneKey }] : []
    ),
    artifacts: rows,
    subtitleTracks,
    audioManifest: parsedIngest.data.audioManifest,
    audioAllocation: parsedIngest.data.audioAllocation,
    targetResolution: input.targetResolution,
    musicKey: input.musicKey,
  })
  const issues = mergeIssues(storageIssues, result.blockingIssues)
  if (result.plan) {
    await validateFiles(input.storage, result.plan, issues)
  }
  const requiredShotCount = parsedIngest.data.audioAllocation.shots.length
  return {
    plan: issues.length === 0 ? result.plan : null,
    blockingIssues: issues,
    narrationReadyCount: readyCount(requiredShotCount, issues, 'narration'),
    subtitleReadyCount: readyCount(requiredShotCount, issues, 'subtitle'),
    requiredShotCount,
  }
}

function latest<T extends {
    aggregateId: string
    kind: string
    version: number
  }>(
  rows: T[],
  aggregateId: string,
  kind: string
): T | undefined {
  return rows
    .filter((row) => row.aggregateId === aggregateId && row.kind === kind)
    .sort((left, right) => right.version - left.version)[0]
}

async function readJsonArtifact(
  storage: StorageAdapter,
  artifact: { storageKey: string; contentHash: string }
): Promise<
  | { status: 'ok'; value: unknown }
  | { status: 'missing' | 'invalid' }
> {
  if (!(await storage.exists(artifact.storageKey))) {
    return { status: 'missing' }
  }
  try {
    const bytes = await storage.get(artifact.storageKey)
    if (digest(bytes) !== artifact.contentHash) return { status: 'invalid' }
    return {
      status: 'ok',
      value: JSON.parse(bytes.toString('utf-8')) as unknown,
    }
  } catch {
    return { status: 'invalid' }
  }
}

function mergeIssues(
  preferred: ExportBlockingIssue[],
  remaining: ExportBlockingIssue[]
): ExportBlockingIssue[] {
  const result = [...preferred]
  for (const issue of remaining) {
    if (
      !result.some(
        (current) =>
          current.laneKey === issue.laneKey && current.kind === issue.kind
      )
    ) {
      result.push(issue)
    }
  }
  return result
}

async function validateFiles(
  storage: StorageAdapter,
  plan: MediaAssemblyPlan,
  issues: ExportBlockingIssue[]
): Promise<void> {
  for (const shot of plan.shots) {
    await validateRef(storage, shot.laneKey, 'render', shot.video, issues)
    await validateRef(
      storage,
      shot.laneKey,
      'narration',
      shot.narration.artifact,
      issues
    )
    await validateRef(storage, shot.laneKey, 'subtitle', shot.subtitle, issues)
  }
}

async function validateRef(
  storage: StorageAdapter,
  laneKey: string,
  kind: ExportBlockingIssue['kind'],
  artifact: { storageKey: string; contentHash: string },
  issues: ExportBlockingIssue[]
): Promise<void> {
  if (!(await storage.exists(artifact.storageKey))) {
    issues.push({ laneKey, kind, code: 'artifact-missing' })
    return
  }
  const bytes = await storage.get(artifact.storageKey)
  if (digest(bytes) !== artifact.contentHash) {
    issues.push({ laneKey, kind, code: 'artifact-invalid' })
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function blocked(
  nodes: AssemblyNode[],
  code: ExportBlockingIssue['code']
): LoadedMediaAssembly {
  return {
    plan: null,
    blockingIssues: [{ laneKey: null, kind: 'render', code }],
    narrationReadyCount: 0,
    subtitleReadyCount: 0,
    requiredShotCount: nodes.filter((node) => node.type === 'shot-codegen').length,
  }
}

function readyCount(
  total: number,
  issues: ExportBlockingIssue[],
  kind: ExportBlockingIssue['kind']
): number {
  return Math.max(
    0,
    total - new Set(issues.filter((issue) => issue.kind === kind).map((issue) => issue.laneKey)).size
  )
}
