import { describe, expect, it, vi } from 'vitest'
import { selectIngestAudioArtifact } from './media-assembly-loader'

vi.mock('server-only', () => ({}))

interface ArtifactRow {
  aggregateId: string
  kind: string
  version: number
  marker: string
}

describe('selectIngestAudioArtifact', () => {
  const rows: ArtifactRow[] = [
    {
      aggregateId: 'ingest-node',
      kind: 'director-ingest',
      version: 2,
      marker: 'legacy',
    },
    {
      aggregateId: 'ingest-node',
      kind: 'director-ingest-audio',
      version: 1,
      marker: 'async-audio',
    },
  ]

  it('prefers the asynchronous audio artifact over the legacy ingest payload', () => {
    expect(
      selectIngestAudioArtifact(rows, 'ingest-node')?.marker
    ).toBe('async-audio')
  })

  it('falls back to the legacy ingest payload for historical projects', () => {
    expect(
      selectIngestAudioArtifact(
        rows.filter((row) => row.kind === 'director-ingest'),
        'ingest-node'
      )?.marker
    ).toBe('legacy')
  })
})
