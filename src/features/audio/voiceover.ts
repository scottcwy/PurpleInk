import { z } from 'zod'
import {
  synthesizeSpeech,
  type SynthesizedSpeech,
} from './stepfun-audio-client'
import {
  storeAudioArtifact,
  type StoreAudioArtifactInput,
  type StoredAudioArtifact,
} from './repository'
import type { VoiceoverInput, VoiceoverResult } from './types'

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    shotId: z.string().min(1),
    text: z.string().trim().min(1),
    voiceId: z.string().trim().min(1).optional(),
  })
  .strict()

interface VoiceoverDependencies {
  synthesize: (input: {
    text: string
    voiceId?: string
  }) => Promise<SynthesizedSpeech>
  storeArtifact: (
    input: StoreAudioArtifactInput
  ) => Promise<StoredAudioArtifact>
}

/** PRD F11：真实 StepFun TTS + StorageAdapter/artifact 落盘。 */
export async function generateVoiceover(
  input: VoiceoverInput,
  dependencies: VoiceoverDependencies = {
    synthesize: synthesizeSpeech,
    storeArtifact: storeAudioArtifact,
  }
): Promise<VoiceoverResult> {
  const parsed = inputSchema.parse(input)
  const speech = await dependencies.synthesize({
    text: parsed.text,
    voiceId: parsed.voiceId,
  })
  const audio = await dependencies.storeArtifact({
    projectId: parsed.projectId,
    nodeId: parsed.nodeId,
    shotId: parsed.shotId,
    kind: 'voiceover-audio',
    extension: speech.audioFormat,
    data: speech.audioBytes,
  })
  const metadata = await dependencies.storeArtifact({
    projectId: parsed.projectId,
    nodeId: parsed.nodeId,
    shotId: parsed.shotId,
    kind: 'voiceover-metadata',
    extension: 'json',
    data: JSON.stringify({
      version: 1,
      shotId: parsed.shotId,
      model: speech.model,
      durationMs: speech.durationMs,
      audioArtifactId: audio.id,
      audioKey: audio.storageKey,
      audioFormat: speech.audioFormat,
      nativeCaptions: speech.nativeCaptions,
    }),
  })
  return {
    kind: 'voiceover',
    status: 'ready',
    shotId: parsed.shotId,
    model: speech.model,
    nativeCaptions: speech.nativeCaptions,
    track: {
      shotId: parsed.shotId,
      audioArtifactId: audio.id,
      audioKey: audio.storageKey,
      metadataArtifactId: metadata.id,
      metadataKey: metadata.storageKey,
      durationMs: speech.durationMs,
    },
  }
}
