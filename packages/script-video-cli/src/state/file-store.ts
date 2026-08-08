import { createHash, randomUUID } from 'node:crypto'
import { access, appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  artifactRecordSchema,
  artifactIndexSchema,
  runEventSchema,
  runRecordSchema,
  stageRecordSchema,
  type ArtifactRecord,
  type ArtifactInput,
  type RunEventInput,
  type RunInputRecord,
  type RunRecord,
  type RunStatus,
  type StageRecord,
  type StateStore,
} from './store'
import { createRunId } from './run-id'

export class FileStateStore implements StateStore {
  private readonly eventWrites = new Map<string, Promise<void>>()
  private readonly artifactWrites = new Map<string, Promise<void>>()

  constructor(private readonly rootDir: string) {}

  async createRun(input: RunInputRecord): Promise<RunRecord> {
    const runId = input.runId ?? createRunId(input.inputHash)
    const runDir = resolve(this.rootDir, runId)
    assertChildPath(this.rootDir, runDir)
    if (await exists(runDir)) throw new Error(`run 已存在: ${runId}`)
    await mkdir(join(runDir, 'state', 'stages'), { recursive: true })
    await mkdir(join(runDir, 'artifacts'), { recursive: true })
    await mkdir(join(runDir, 'input'), { recursive: true })
    const now = new Date().toISOString()
    const record: RunRecord = {
      schemaVersion: 1,
      runId,
      runDir,
      inputHash: input.inputHash,
      title: input.title,
      workflowVersion: input.workflowVersion,
      status: 'created',
      createdAt: now,
      updatedAt: now,
    }
    await this.writeRun(record)
    return record
  }

  async readRun(runDir: string): Promise<RunRecord> {
    const value = JSON.parse(await readFile(join(runDir, 'state', 'run.json'), 'utf8')) as unknown
    return runRecordSchema.parse(value)
  }

  async updateRun(runDir: string, patch: { status?: RunStatus; queueJobId?: string }): Promise<RunRecord> {
    const current = await this.readRun(runDir)
    const next = runRecordSchema.parse({
      ...current,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.queueJobId ? { queueJobId: patch.queueJobId } : {}),
      updatedAt: new Date().toISOString(),
    })
    await this.writeRun(next)
    return next
  }

  async writeStage(
    runDir: string,
    stage: Omit<StageRecord, 'schemaVersion' | 'updatedAt' | 'startedAt' | 'finishedAt'>,
  ): Promise<void> {
    const previous = await this.readStage(runDir, stage.key)
    const now = new Date().toISOString()
    const value = stageRecordSchema.parse({
      schemaVersion: 1,
      ...stage,
      startedAt: previous?.startedAt ?? (stage.status === 'running' ? now : undefined),
      finishedAt: stage.status === 'running' || stage.status === 'queued' ? undefined : now,
      updatedAt: now,
    })
    await this.writeJson(join(runDir, 'state', 'stages', stageFileName(stage.key)), value)
    await this.appendEvent(runDir, {
      type: 'stage.updated',
      data: { key: stage.key, status: stage.status, attempt: stage.attempt },
    })
  }

  async readStage(runDir: string, key: string): Promise<StageRecord | null> {
    const path = join(runDir, 'state', 'stages', stageFileName(key))
    if (!(await exists(path))) return null
    return stageRecordSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
  }

  async appendEvent(runDir: string, event: RunEventInput): Promise<void> {
    const path = join(runDir, 'state', 'events.jsonl')
    const previous = this.eventWrites.get(path) ?? Promise.resolve()
    const current = previous.then(async () => {
      const value = runEventSchema.parse({
        schemaVersion: 1,
        ...event,
        timestamp: new Date().toISOString(),
      })
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
    })
    this.eventWrites.set(
      path,
      current.catch(() => undefined),
    )
    await current
  }

  async writeArtifact(runDir: string, artifact: ArtifactInput): Promise<void> {
    const previous = this.artifactWrites.get(runDir) ?? Promise.resolve()
    const current = previous.then(async () => {
      const absolutePath = resolve(artifact.absolutePath ?? join(runDir, ...artifact.relativePath.split('/')))
      assertChildPath(runDir, absolutePath)
      const value = artifactRecordSchema.parse({
        schemaVersion: 1,
        ...artifact,
        absolutePath,
        createdAt: new Date().toISOString(),
      })
      await this.writeJson(join(runDir, 'artifacts', `${safeFilePart(artifact.id)}.json`), value)
      const indexPath = join(runDir, 'artifacts', 'index.json')
      const index = await readArtifactIndex(indexPath)
      const artifacts = [...index.artifacts.filter((item) => item.id !== value.id), value].sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      await this.writeJson(indexPath, artifactIndexSchema.parse({ schemaVersion: 1, artifacts }))
    })
    this.artifactWrites.set(
      runDir,
      current.catch(() => undefined),
    )
    await current
  }

  async assertResumeCompatible(
    runDir: string,
    input: Pick<RunInputRecord, 'inputHash' | 'workflowVersion'>,
  ): Promise<void> {
    const run = await this.readRun(runDir)
    if (run.inputHash !== input.inputHash) throw new Error('resume input hash 不一致')
    if (run.workflowVersion !== input.workflowVersion) {
      throw new Error('resume workflow version 不一致')
    }
  }

  private async writeRun(record: RunRecord): Promise<void> {
    await this.writeJson(join(record.runDir, 'state', 'run.json'), record)
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tempPath = `${path}.tmp-${randomUUID()}`
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(tempPath, path)
  }
}

async function readArtifactIndex(path: string): Promise<{ schemaVersion: 1; artifacts: ArtifactRecord[] }> {
  if (!(await exists(path))) return { schemaVersion: 1, artifacts: [] }
  return artifactIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

function stageFileName(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}.json`
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]/giu, '_').slice(0, 120) || 'artifact'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertChildPath(root: string, target: string): void {
  if (!isAbsolute(root) || !isAbsolute(target)) throw new Error('状态目录必须是绝对路径')
  const path = relative(resolve(root), target)
  if (path === '' || path.startsWith('..') || isAbsolute(path)) {
    throw new Error('run 目录必须位于状态根目录内')
  }
}
