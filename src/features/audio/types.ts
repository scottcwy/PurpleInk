export interface Caption {
  startMs: number
  endMs: number
  text: string
}

export interface VoiceoverTrack {
  shotId: string
  audioArtifactId: string
  audioKey: string
  metadataArtifactId: string
  metadataKey: string
  durationMs: number
}

export interface BgmPlan {
  trackKey: string
  gainDb: number
}

export interface SfxCue {
  shotId: string
  atMs: number
  sfxKey: string
}

export interface SubtitleInput {
  projectId: string
  nodeId: string
  shotId: string
  script: string
  audioArtifactId: string
  audioKey: string
  audioBytes: Buffer
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
}

export interface VoiceoverInput {
  projectId: string
  nodeId: string
  shotId: string
  text: string
  voiceId?: string
}

export interface SfxInput {
  shotId: string
  brief?: string
}

export interface ScoreInput {
  projectId: string
  brief?: string
}

interface PlaceholderResult {
  status: 'placeholder'
  implementation: 'P1'
  note: '占位实现，P1 补齐'
}

export interface SubtitleResult {
  kind: 'subtitle'
  status: 'ready'
  shotId: string
  captions: Caption[]
  transcript: string
  model: string
  alignmentSource: 'stepfun-asr'
  trackArtifactId: string
  trackKey: string
}

export interface VoiceoverResult {
  kind: 'voiceover'
  status: 'ready'
  shotId: string
  model: string
  nativeCaptions: Caption[]
  track: VoiceoverTrack
}

export interface SfxResult extends PlaceholderResult {
  kind: 'sfx'
  shotId: string
  cues: SfxCue[]
}

export interface ScoreResult extends PlaceholderResult {
  kind: 'score'
  projectId: string
  plan: BgmPlan | null
}
