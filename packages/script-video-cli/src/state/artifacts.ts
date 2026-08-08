import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative } from 'node:path'

import type { StateStore } from './store'

export async function registerFileArtifact(
  store: StateStore,
  runDir: string,
  input: { id: string; kind: string; path: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const info = await stat(input.path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(input.path)) hash.update(chunk)
  await store.writeArtifact(runDir, {
    id: input.id,
    kind: input.kind,
    relativePath: relative(runDir, input.path)
      .split(/[\\/]+/u)
      .join('/'),
    sizeBytes: info.size,
    contentHash: hash.digest('hex'),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
}
