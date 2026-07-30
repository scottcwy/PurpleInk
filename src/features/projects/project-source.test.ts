import { describe, expect, it } from 'vitest'
import {
  parseProjectSourcePayload,
  PROJECT_SOURCE_SCHEMA_VERSION,
} from './project-source'

describe('parseProjectSourcePayload', () => {
  it('normalizes a website URL without storing browser credentials or fragments', () => {
    const source = parseProjectSourcePayload({
      schemaVersion: PROJECT_SOURCE_SCHEMA_VERSION,
      kind: 'website',
      url: 'HTTPS://Example.COM:443/docs?mode=demo#private-panel',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })

    expect(source).toEqual({
      schemaVersion: 1,
      kind: 'website',
      url: 'https://example.com/docs?mode=demo',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
    })
  })

  it.each([
    {
      schemaVersion: 1,
      kind: 'script',
      script: '产品事实文稿',
      visualTheme: 'light',
      prompt: '不得持久化内部提示词',
    },
    {
      schemaVersion: 1,
      kind: 'website',
      url: 'https://example.com',
      durationSec: 24,
      quality: 'standard',
      visualTheme: 'dark',
      headers: { authorization: 'secret' },
    },
    {
      schemaVersion: 1,
      kind: 'audio',
      storageKey: '../outside/source.wav',
      fileName: 'source.wav',
      mimeType: 'audio/wav',
      container: 'wav',
      sizeBytes: 128,
      durationMs: 1_000,
      sampleRate: 48_000,
      sampleCount: 48_000,
      visualTheme: 'dark',
    },
  ])('rejects unsafe or undeclared source fields', (input) => {
    expect(() => parseProjectSourcePayload(input)).toThrow()
  })

  it('accepts only a controlled audio artifact reference and measured metadata', () => {
    const source = parseProjectSourcePayload({
      schemaVersion: 1,
      kind: 'audio',
      storageKey: 'workspace/project/source-recording.wav',
      fileName: '产品录音.wav',
      mimeType: 'audio/wav',
      container: 'wav',
      sizeBytes: 96_044,
      durationMs: 1_000,
      sampleRate: 48_000,
      sampleCount: 48_000,
      visualTheme: 'light',
    })

    expect(source.kind).toBe('audio')
    expect(Object.keys(source)).not.toContain('audioBytes')
  })
})
