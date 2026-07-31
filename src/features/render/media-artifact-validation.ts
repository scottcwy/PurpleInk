import { createHash } from 'node:crypto'
import type { StorageAdapter } from '@/lib/storage'
import type {
  ExportBlockingIssue,
  MediaAssemblyPlan,
} from './media-assembly'

interface IndexedArtifactSize {
  artifactId: string
  sizeBytes: number
}

/**
 * 装配合同通过后仍逐个核验实际存储字节。
 *
 * DB Artifact 的 hash 与 size 都是门禁；降级模式临时生成的占位引用不在 rows 中，
 * 因而只校验它声明的 hash。
 */
export async function validateMediaAssemblyFiles(
  storage: StorageAdapter,
  plan: MediaAssemblyPlan,
  indexedArtifacts: IndexedArtifactSize[],
  issues: ExportBlockingIssue[],
): Promise<void> {
  const sizes = new Map(
    indexedArtifacts.map((artifact) => [
      artifact.artifactId,
      artifact.sizeBytes,
    ]),
  )
  for (const shot of plan.shots) {
    await validateRef(
      storage,
      shot.laneKey,
      'render',
      shot.video,
      sizes.get(shot.video.artifactId),
      issues,
    )
    await validateRef(
      storage,
      shot.laneKey,
      'narration',
      shot.narration.artifact,
      sizes.get(shot.narration.artifact.artifactId),
      issues,
    )
    if (shot.subtitle) {
      await validateRef(
        storage,
        shot.laneKey,
        'subtitle',
        shot.subtitle,
        sizes.get(shot.subtitle.artifactId),
        issues,
      )
    }
  }
}

async function validateRef(
  storage: StorageAdapter,
  laneKey: string,
  kind: ExportBlockingIssue['kind'],
  artifact: { storageKey: string; contentHash: string },
  expectedSize: number | undefined,
  issues: ExportBlockingIssue[],
): Promise<void> {
  if (!(await storage.exists(artifact.storageKey))) {
    issues.push({ laneKey, kind, code: 'artifact-missing' })
    return
  }
  const bytes = await storage.get(artifact.storageKey)
  if (
    (expectedSize !== undefined && bytes.byteLength !== expectedSize) ||
    digest(bytes) !== artifact.contentHash
  ) {
    issues.push({ laneKey, kind, code: 'artifact-invalid' })
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
