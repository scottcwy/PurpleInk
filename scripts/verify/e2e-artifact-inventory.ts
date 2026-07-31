import { createHash } from 'node:crypto'

export interface ArtifactInventoryRow {
  id: string
  kind: string
  version: number
  sizeBytes: number
  contentHash: string
  hashMatches: boolean
  actualSize: number | null
}

/** 逐条核对 artifact 的登记哈希与磁盘实际字节 SHA-256。 */
export async function readArtifactInventory(
  projectId: string,
): Promise<ArtifactInventoryRow[]> {
  const { getDb } = await import('@/lib/db/client')
  const { artifacts } = await import('@/lib/db/schema/index')
  const { eq } = await import('drizzle-orm')
  const { storage } = await import('@/lib/storage')
  const database = await getDb()
  const rows = await database
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      version: artifacts.version,
      sizeBytes: artifacts.sizeBytes,
      contentHash: artifacts.contentHash,
      storageKey: artifacts.storageKey,
    })
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
  const inventory: ArtifactInventoryRow[] = []
  for (const row of rows) {
    let actual: Buffer | null = null
    try {
      actual = await storage.get(row.storageKey)
    } catch {
      actual = null
    }
    const digest = actual
      ? createHash('sha256').update(actual).digest('hex')
      : null
    inventory.push({
      id: row.id,
      kind: row.kind,
      version: row.version,
      sizeBytes: row.sizeBytes,
      contentHash: row.contentHash,
      hashMatches: digest === row.contentHash,
      actualSize: actual?.byteLength ?? null,
    })
  }
  return inventory
}
