import { createHash } from 'node:crypto'
import type { ProjectSourcePayload } from './project-source'

export function fingerprintProjectCreationRequest(input: {
  title: string
  source: ProjectSourcePayload
  sourceFingerprint: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.title,
      input.source.kind,
      input.sourceFingerprint,
      canonicalSourceForCreation(input.source),
    ]))
    .digest('hex')
}

function canonicalSourceForCreation(source: ProjectSourcePayload): unknown {
  if (source.kind !== 'audio') return source
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== 'storageKey'),
  )
}
