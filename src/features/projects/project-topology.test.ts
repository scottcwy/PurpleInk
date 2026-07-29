import { describe, expect, it } from 'vitest'
import { parseProjectSourcePayload } from './project-source'
import { buildProjectTopology } from './project-topology'

describe('buildProjectTopology', () => {
  it('keeps the script workflow serialized exactly like the existing createProject baseline', () => {
    const topology = buildProjectTopology(
      parseProjectSourcePayload({
        schemaVersion: 1,
        kind: 'script',
        script: '一段产品事实文稿',
        visualTheme: 'light',
      }),
    )

    expect(JSON.stringify(topology)).toBe(
      JSON.stringify({
        nodes: [
          {
            type: 'script-import',
            stage: 'INGEST',
            logicalKey: 'global:script-import',
            data: {
              schemaVersion: 1,
              payload: {
                directorInput: { rawScript: '一段产品事实文稿' },
                visualTheme: 'light',
              },
            },
          },
          {
            type: 'shot-split',
            stage: 'DIRECT',
            logicalKey: 'global:shot-split',
            data: { schemaVersion: 1, payload: {} },
          },
          {
            type: 'score',
            stage: 'ASSEMBLE',
            logicalKey: 'global:score',
            data: { schemaVersion: 1, payload: {} },
          },
          {
            type: 'export',
            stage: 'FINALIZE',
            logicalKey: 'global:export',
            data: { schemaVersion: 1, payload: {} },
          },
        ],
        edges: [
          {
            sourceLogicalKey: 'global:script-import',
            targetLogicalKey: 'global:shot-split',
          },
          {
            sourceLogicalKey: 'global:score',
            targetLogicalKey: 'global:export',
          },
        ],
      }),
    )
  })

  it('uses the original-audio entry while preserving the main workflow fan-out gap', () => {
    const topology = buildProjectTopology(
      parseProjectSourcePayload({
        schemaVersion: 1,
        kind: 'audio',
        storageKey: 'workspace/project/private/source.wav',
        fileName: '产品录音.wav',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: 96_044,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
        visualTheme: 'dark',
      }),
    )

    expect(topology.nodes.map(({ type }) => type)).toEqual([
      'audio-transcribe',
      'shot-split',
      'score',
      'export',
    ])
    expect(topology.edges).toEqual([
      {
        sourceLogicalKey: 'source:audio-transcribe',
        targetLogicalKey: 'global:shot-split',
      },
      {
        sourceLogicalKey: 'global:score',
        targetLogicalKey: 'global:export',
      },
    ])
    expect(JSON.stringify(topology)).not.toContain('workspace/project/private')
    expect(JSON.stringify(topology)).not.toContain('产品录音.wav')
  })

  it('builds the six website phases as one strict sequential chain', () => {
    const topology = buildProjectTopology(
      parseProjectSourcePayload({
        schemaVersion: 1,
        kind: 'website',
        url: 'https://example.com/demo?token=private-value#internal',
        durationSec: 24,
        quality: 'standard',
        visualTheme: 'dark',
      }),
    )

    expect(
      topology.nodes.map(({ type, stage, logicalKey }) => ({
        type,
        stage,
        logicalKey,
      })),
    ).toEqual([
      { type: 'website-stage', stage: 'INGEST', logicalKey: 'website:capture' },
      { type: 'website-stage', stage: 'DIRECT', logicalKey: 'website:script' },
      {
        type: 'website-stage',
        stage: 'SHOT_SPEC',
        logicalKey: 'website:narration',
      },
      {
        type: 'website-stage',
        stage: 'FABRICATE',
        logicalKey: 'website:compose',
      },
      {
        type: 'website-stage',
        stage: 'ASSEMBLE',
        logicalKey: 'website:render',
      },
      {
        type: 'website-stage',
        stage: 'FINALIZE',
        logicalKey: 'website:export',
      },
    ])
    expect(topology.edges).toEqual([
      {
        sourceLogicalKey: 'website:capture',
        targetLogicalKey: 'website:script',
      },
      {
        sourceLogicalKey: 'website:script',
        targetLogicalKey: 'website:narration',
      },
      {
        sourceLogicalKey: 'website:narration',
        targetLogicalKey: 'website:compose',
      },
      {
        sourceLogicalKey: 'website:compose',
        targetLogicalKey: 'website:render',
      },
      {
        sourceLogicalKey: 'website:render',
        targetLogicalKey: 'website:export',
      },
    ])

    const serialized = JSON.stringify(topology)
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('private-value')
  })
})
