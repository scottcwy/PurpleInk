import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_INGEST_SOURCE_NODE_TYPES,
  isDirectorIngestSourceNodeType,
} from './director-ingest-source'

describe('Director ingest source contract', () => {
  it('accepts script and user audio without routing website jobs into Director', () => {
    expect(DIRECTOR_INGEST_SOURCE_NODE_TYPES).toEqual([
      'script-import',
      'audio-transcribe',
    ])
    expect(isDirectorIngestSourceNodeType('script-import')).toBe(true)
    expect(isDirectorIngestSourceNodeType('audio-transcribe')).toBe(true)
    expect(isDirectorIngestSourceNodeType('website-stage')).toBe(false)
  })
})
