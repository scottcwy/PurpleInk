import { describe, expect, it } from 'vitest'
import { artifactPreviewMode } from './preview-mode'

describe('artifactPreviewMode', () => {
  it('classifies text-friendly kinds', () => {
    expect(artifactPreviewMode('director-shot-spec')).toBe('text')
    expect(artifactPreviewMode('director-fabricate')).toBe('text')
    expect(artifactPreviewMode('director-direct')).toBe('text')
    expect(artifactPreviewMode('voiceover-metadata')).toBe('text')
    expect(artifactPreviewMode('assemble-plan-json')).toBe('text')
  })

  it('classifies image kinds', () => {
    expect(artifactPreviewMode('frame-thumbnail')).toBe('image')
  })

  it('classifies media as unsupported', () => {
    expect(artifactPreviewMode('render-mp4')).toBe('unsupported')
    expect(artifactPreviewMode('final-mp4')).toBe('unsupported')
    expect(artifactPreviewMode('voiceover-audio')).toBe('unsupported')
    expect(artifactPreviewMode('narration-audio-zh')).toBe('unsupported')
  })
})
