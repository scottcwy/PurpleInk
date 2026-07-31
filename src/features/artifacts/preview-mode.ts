/**
 * Client-safe preview mode for artifact kinds.
 * Aligned with `artifactContentType`, plus markdown-friendly kinds.
 */
export type ArtifactPreviewMode = 'text' | 'image' | 'unsupported'

export function artifactPreviewMode(kind: string): ArtifactPreviewMode {
  if (kind === 'frame-thumbnail') return 'image'

  if (kind.endsWith('mp4')) return 'unsupported'
  if (kind.startsWith('narration-audio')) return 'unsupported'
  if (kind === 'voiceover-audio') return 'unsupported'

  if (
    kind.includes('json') ||
    kind === 'director-shot-spec' ||
    kind === 'subtitle-track' ||
    kind === 'qa-vision-report' ||
    kind === 'director-fabricate' ||
    kind === 'director-direct' ||
    kind === 'voiceover-metadata'
  ) {
    return 'text'
  }

  return 'unsupported'
}
