import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface FfprobeRunner {
  (path: string): Promise<string>
}

export interface VideoMetadata {
  durationSec: number
  width: number
  height: number
  fps?: number
  videoCodec?: string
  audioPresent: boolean
}

export interface MediaQaResult {
  passed: boolean
  errors: string[]
  path: string
  sizeBytes: number
  contentHash: string
  metadata?: VideoMetadata
}

export interface MediaQaOptions {
  expectedDurationSec?: number
  durationToleranceSec?: number
  expectedWidth?: number
  expectedHeight?: number
  runner?: FfprobeRunner
}

interface FfprobeJson {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    r_frame_rate?: string
    duration?: string
  }>
  format?: { duration?: string }
}

export async function inspectVideoArtifact(path: string, options: MediaQaOptions = {}): Promise<MediaQaResult> {
  const contentHash = await sha256File(path)
  const sizeBytes = (await stat(path)).size
  const runner = options.runner ?? runFfprobe
  try {
    const parsed = JSON.parse(await runner(path)) as unknown
    const data = parseFfprobe(parsed)
    const errors = validateMetadata(data, options)
    return { passed: errors.length === 0, errors, path, sizeBytes, contentHash, metadata: data }
  } catch {
    return { passed: false, errors: ['ffprobe 失败或返回了不可解析的媒体信息'], path, sizeBytes, contentHash }
  }
}

async function sha256File(path: string): Promise<string> {
  await access(path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function parseFfprobe(value: unknown): VideoMetadata {
  if (!isRecord(value)) throw new Error('invalid ffprobe')
  const streams = Array.isArray(value.streams) ? value.streams.filter(isRecord) : []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('no video stream')
  const width = numberFrom(video.width)
  const height = numberFrom(video.height)
  const duration = numberFrom(video.duration) ?? numberFrom(isRecord(value.format) ? value.format.duration : undefined)
  if (width === undefined || height === undefined || duration === undefined)
    throw new Error('incomplete media metadata')
  return {
    durationSec: duration,
    width,
    height,
    fps: parseFps(video.r_frame_rate),
    videoCodec: stringFrom(video.codec_name),
    audioPresent: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

function validateMetadata(metadata: VideoMetadata, options: MediaQaOptions): string[] {
  const errors: string[] = []
  if (options.expectedDurationSec !== undefined) {
    const tolerance = options.durationToleranceSec ?? 0.25
    if (Math.abs(metadata.durationSec - options.expectedDurationSec) > tolerance) errors.push('duration 不符合预期')
  }
  if (options.expectedWidth !== undefined && metadata.width !== options.expectedWidth) errors.push('width 不符合预期')
  if (options.expectedHeight !== undefined && metadata.height !== options.expectedHeight)
    errors.push('height 不符合预期')
  return errors
}

function parseFps(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const [numerator, denominator] = value.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined
  return numerator / denominator
}

function numberFrom(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(result) ? result : undefined
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const runFfprobe: FfprobeRunner = async (path) => {
  const result = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  )
  return result.stdout
}
