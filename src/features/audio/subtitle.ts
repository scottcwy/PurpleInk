import { z } from 'zod'
import {
  needsWholeClipAlignment,
  transcribeRoutedSpeech,
  type RoutedTranscribedSpeech,
  type SubtitleAlignmentSource,
  type TranscribedSpeech,
} from './media-provider'
import { measureAudio, type MeasuredAudio } from './measure'
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
    billingContext: z.object({
      attemptId: z.string().min(1),
      invocationNo: z.number().int().min(1),
    }).strict().optional(),
  })
  .strict()

interface SubtitleDependencies {
  transcribe: (input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
    audioSeconds: number
    billingContext?: {
      attemptId: string
      invocationNo: number
    }
  }) => Promise<TranscribedSpeech | RoutedTranscribedSpeech>
  measure?: (bytes: Buffer) => Promise<MeasuredAudio>
  storeArtifact: (
    input: StoreAudioArtifactInput
  ) => Promise<StoredAudioArtifact>
}

/** PRD F10：用真实 ASR 输出和实测音频区间生成可追溯字幕轨道。 */
export async function generateSubtitle(
  input: SubtitleInput,
  dependencies: SubtitleDependencies = {
    transcribe: transcribeRoutedSpeech,
    measure: measureAudio,
    storeArtifact: storeAudioArtifact,
  }
): Promise<SubtitleResult> {
  const parsed = inputSchema.parse(input)
  const measured = await (dependencies.measure ?? measureAudio)(parsed.audioBytes)
  const transcription = await dependencies.transcribe({
    audioBytes: parsed.audioBytes,
    audioFormat: parsed.audioFormat,
    audioSeconds: measured.durationMs / 1000,
    billingContext: parsed.billingContext,
  })
  const alignmentSource = readAlignmentSource(transcription)
  let captions = transcription.captions
  // 用谓词而不是逐个比较取值：新增一种「无逐段时间戳」的 ASR 端点时漏掉这里，
  // 会产出零 caption 的字幕轨，也就是一个永久空产物。
  if (captions.length === 0 && needsWholeClipAlignment(alignmentSource)) {
    captions = [{
      text: transcription.transcript,
      startMs: 0,
      endMs: measured.durationMs,
    }]
  }
  if (captions.length === 0) {
    throw new Error('ASR 未返回可用的字幕时间戳')
  }
  const trackContent = {
    version: 1,
    shotId: parsed.shotId,
    sourceText: parsed.script,
    transcript: transcription.transcript,
    model: transcription.model,
    alignmentSource,
    sourceAudioArtifactId: parsed.audioArtifactId,
    sourceAudioKey: parsed.audioKey,
    captions,
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
    alignmentSource,
    captions,
    trackArtifactId: track.id,
    trackKey: track.storageKey,
  }
}

function readAlignmentSource(
  transcription: TranscribedSpeech | RoutedTranscribedSpeech
): SubtitleAlignmentSource {
  return 'alignmentSource' in transcription
    ? transcription.alignmentSource
    : 'stepfun-asr'
}
