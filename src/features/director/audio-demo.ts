import { createHash } from 'node:crypto'
import {
  audioAllocationSchema,
  audioManifestSchema,
  type AudioAllocation,
  type AudioManifest,
  type ScriptUnit,
} from './schemas/ingest'

const DEFAULT_UNIT_DURATION_MS = 8000
const DEFAULT_FPS = 30
const DEFAULT_SAMPLE_RATE_HZ = 24000

export function buildDemoAudioManifest(scriptUnits: ScriptUnit[]): AudioManifest {
  const totalMs = DEFAULT_UNIT_DURATION_MS * scriptUnits.length
  const manifest: AudioManifest = {
    version: 1,
    engine: 'demo-tts',
    units: scriptUnits.map((unit) => ({
      unitId: unit.unitId,
      text: unit.text,
      audioFile: 'project://audio/demo.mp3',
      durationMs: DEFAULT_UNIT_DURATION_MS,
      source: 'tts',
      sampleRateHz: DEFAULT_SAMPLE_RATE_HZ,
      sampleCount: (DEFAULT_UNIT_DURATION_MS * DEFAULT_SAMPLE_RATE_HZ) / 1000,
    })),
    totalMs,
  }
  return audioManifestSchema.parse(manifest)
}

export function buildDemoAudioAllocation(
  scriptUnits: ScriptUnit[],
  audioManifest: AudioManifest
): AudioAllocation {
  const durationInFrames = Math.round((DEFAULT_UNIT_DURATION_MS * DEFAULT_FPS) / 1000)
  const sampleCountPerUnit = (DEFAULT_UNIT_DURATION_MS * DEFAULT_SAMPLE_RATE_HZ) / 1000
  const shots = scriptUnits.map((unit, index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    audioUnitId: unit.unitId,
    scriptRange: { startChar: 0, endChar: Math.min(unit.text.length, 50) },
    substring: unit.text.slice(0, 50),
    startInUnitMs: 0,
    endInUnitMs: DEFAULT_UNIT_DURATION_MS,
    startSample: Math.round(index * sampleCountPerUnit),
    endSample: Math.round((index + 1) * sampleCountPerUnit),
    durationInFrames,
    allocationMethod: 'duration-weight-fallback' as const,
  }))
  const allocation: AudioAllocation = {
    schemaVersion: 1,
    inputDigests: {
      audioManifest: sha256Digest(JSON.stringify(audioManifest)),
      runtimeBindings: sha256Digest(JSON.stringify({})),
      scriptUnits: sha256Digest(JSON.stringify(scriptUnits)),
    },
    fps: DEFAULT_FPS,
    shots,
    totalFrames: durationInFrames * shots.length,
  }
  return audioAllocationSchema.parse(allocation)
}

function sha256Digest(input: string): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}
