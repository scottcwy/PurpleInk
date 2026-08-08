import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AiClient } from '../ai/openai-compatible'
import type { ShotPlan } from '../contracts'
import { FileStateStore } from '../state/file-store'
import { VoiceStore } from '../voice/voice-store'
import type { MimoSpeechClient } from './mimo-client'
import { synthesizeShotNarrations } from './narration'
import { bindTranscriptGroups, transcribeAudio } from './transcription'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local speech pipeline', () => {
  it('inherits FFmpeg timestamps and derives shot duration from real WAV bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-speech-pipeline-'))
    roots.push(root)
    const sourcePath = join(root, 'source.wav')
    const wav = createToneWav(1)
    await writeFile(sourcePath, wav)
    const store = new FileStateStore(join(root, 'runs'))
    const run = await store.createRun({
      inputHash: createHash('sha256').update(wav).digest('hex'),
      title: '语音测试',
      workflowVersion: 'test-v1',
    })
    const speech: MimoSpeechClient = {
      transcribe: async () => ({ text: '这是一段真实边界的测试语音。' }),
      synthesize: async () => ({ audio: wav, mimeType: 'audio/wav' }),
    }
    const ai: AiClient = {
      completeText: async () => '',
      completeJson: async () => ({
        title: '语音测试',
        language: 'zh-CN',
        units: [
          {
            id: 'U001',
            sourceSegmentIds: ['U001'],
            visualIntent: 'show',
          },
        ],
      }),
    }
    const transcript = await transcribeAudio(sourcePath, {
      outputDir: run.runDir,
      ai,
      speech,
      concurrency: 2,
      store,
      runDir: run.runDir,
    })
    expect(transcript.input.units[0]?.startMs).toBe(0)
    expect(transcript.input.units[0]?.endMs).toBeGreaterThanOrEqual(900)
    expect(await readFile(transcript.transcriptMarkdownPath, 'utf8')).toContain('U001')

    const plan: ShotPlan = {
      id: 'S001',
      sourceUnitId: 'U001',
      purpose: '解释语音内容',
      visualIntent: 'show',
      composition: 'diagram',
      visualDescription: '展示语音时间线',
      facts: [transcript.input.units[0]!.text],
      onScreenText: ['语音测试'],
      durationSec: 5,
    }
    const narration = await synthesizeShotNarrations(transcript.input, [plan], {
      outputDir: run.runDir,
      speech,
      voiceStore: new VoiceStore({
        rootDir: join(root, 'voices'),
        indexPath: join(root, 'voices', 'index.json'),
        samplesDir: join(root, 'voices', 'samples'),
      }),
      concurrency: 2,
      store,
      runDir: run.runDir,
    })
    expect(narration.failed).toHaveLength(0)
    expect(narration.shots[0]?.durationSec).toBeCloseTo(1, 1)
    expect(narration.effectivePlans[0]?.durationSec).toBeCloseTo(1.35, 1)
  }, 20_000)

  it('merges only adjacent ASR segments and inherits their real outer timestamps', () => {
    const segments = [
      { id: 'U001', startMs: 100, endMs: 900, text: '第一句。', audioPath: '1.wav' },
      { id: 'U002', startMs: 1_000, endMs: 1_900, text: '第二句。', audioPath: '2.wav' },
      { id: 'U003', startMs: 2_000, endMs: 2_800, text: '新观点。', audioPath: '3.wav' },
    ]

    expect(
      bindTranscriptGroups(
        [
          { id: 'U001', sourceSegmentIds: ['U001', 'U002'], visualIntent: 'show' },
          { id: 'U002', sourceSegmentIds: ['U003'], visualIntent: 'contrast' },
        ],
        segments,
      ),
    ).toEqual([
      { id: 'U001', text: '第一句。 第二句。', startMs: 100, endMs: 1_900, visualIntent: 'show' },
      { id: 'U002', text: '新观点。', startMs: 2_000, endMs: 2_800, visualIntent: 'contrast' },
    ])
  })
})

function createToneWav(durationSec: number): Buffer {
  const sampleRate = 16_000
  const sampleCount = Math.round(sampleRate * durationSec)
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 10_000), 44 + index * 2)
  }
  return buffer
}
