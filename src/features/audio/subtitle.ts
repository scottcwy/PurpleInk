import { z } from 'zod'
import {
  transcribeSpeech,
  type TranscribedSpeech,
} from './stepfun-audio-client'
import {
  storeAudioArtifact,
  type StoreAudioArtifactInput,
  type StoredAudioArtifact,
} from './repository'
import type { SubtitleInput, SubtitleResult } from './types'

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    shotId: z.string().min(1),
    script: z.string().trim().min(1),
    audioArtifactId: z.string().min(1),
    audioKey: z.string().min(1),
    audioBytes: z.instanceof(Buffer).refine((bytes) => bytes.length > 0),
    audioFormat: z.enum(['mp3', 'wav', 'ogg', 'pcm']),
  })
  .strict()

interface SubtitleDependencies {
  transcribe: (input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
  }) => Promise<TranscribedSpeech>
  storeArtifact: (
    input: StoreAudioArtifactInput
  ) => Promise<StoredAudioArtifact>
}

/** PRD F10：用 StepFun ASR 真实时间戳生成可追溯字幕轨道。 */
export async function generateSubtitle(
  input: SubtitleInput,
  dependencies: SubtitleDependencies = {
    transcribe: transcribeSpeech,
    storeArtifact: storeAudioArtifact,
  }
): Promise<SubtitleResult> {
  const parsed = inputSchema.parse(input)
  const transcription = await dependencies.transcribe({
    audioBytes: parsed.audioBytes,
    audioFormat: parsed.audioFormat,
  })
  if (transcription.captions.length === 0) {
    throw new Error('StepFun ASR 未返回可用的字幕时间戳')
  }
  const trackContent = {
    version: 1,
    shotId: parsed.shotId,
    sourceText: parsed.script,
    transcript: transcription.transcript,
    model: transcription.model,
    alignmentSource: 'stepfun-asr' as const,
    sourceAudioArtifactId: parsed.audioArtifactId,
    sourceAudioKey: parsed.audioKey,
    captions: transcription.captions,
  }
  const track = await dependencies.storeArtifact({
    projectId: parsed.projectId,
    nodeId: parsed.nodeId,
    shotId: parsed.shotId,
    kind: 'subtitle-track',
    extension: 'json',
    data: JSON.stringify(trackContent),
  })
  return {
    kind: 'subtitle',
    status: 'ready',
    shotId: parsed.shotId,
    transcript: transcription.transcript,
    model: transcription.model,
    alignmentSource: 'stepfun-asr',
    captions: transcription.captions,
    trackArtifactId: track.id,
    trackKey: track.storageKey,
  }
}
