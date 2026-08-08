import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export interface SpeechSegment {
  startMs: number
  endMs: number
}

interface ProcessOptions {
  cwd?: string
  logPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export async function runLoggedProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  if (options.logPath) await mkdir(dirname(options.logPath), { recursive: true })
  const log = options.logPath ? createWriteStream(options.logPath, { flags: 'a', encoding: 'utf8' }) : undefined
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const record = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const value = redactProcessText(chunk.toString('utf8'))
      if (stream === 'stdout') stdout = boundedAppend(stdout, value)
      else stderr = boundedAppend(stderr, value)
      log?.write(`[${stream}] ${value}`)
    }
    child.stdout?.on('data', (chunk: Buffer) => record('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => record('stderr', chunk))
    const stop = (): void => {
      child.kill()
    }
    const timer = options.timeoutMs ? setTimeout(stop, options.timeoutMs) : undefined
    options.signal?.addEventListener('abort', stop, { once: true })
    child.on('error', (error) => {
      log?.end()
      reject(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      log?.end()
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  options: ProcessOptions = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  await requireSuccess(
    'ffmpeg',
    ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath],
    options,
    'AUDIO_NORMALIZE_FAILED',
  )
}

export async function detectSpeechSegments(
  wavPath: string,
  options: ProcessOptions & { maxSegmentSec?: number } = {},
): Promise<SpeechSegment[]> {
  const durationSec = await probeDuration(wavPath, options)
  const result = await runLoggedProcess(
    'ffmpeg',
    ['-hide_banner', '-i', wavPath, '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-'],
    options,
  )
  if (result.code !== 0) throw processError('ASR_SEGMENT_FAILED')
  const silences = parseSilences(result.stderr, durationSec)
  const speech: Array<{ startSec: number; endSec: number }> = []
  let cursor = 0
  for (const silence of silences) {
    if (silence.startSec - cursor >= 0.15) speech.push({ startSec: cursor, endSec: silence.startSec })
    cursor = Math.max(cursor, silence.endSec)
  }
  if (durationSec - cursor >= 0.15) speech.push({ startSec: cursor, endSec: durationSec })
  const maximum = options.maxSegmentSec ?? 45
  return speech.flatMap((segment) => splitSegment(segment.startSec, segment.endSec, maximum))
}

export async function cutAudioSegment(
  wavPath: string,
  outputPath: string,
  segment: SpeechSegment,
  options: ProcessOptions = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  const start = segment.startMs / 1000
  const duration = (segment.endMs - segment.startMs) / 1000
  await requireSuccess(
    'ffmpeg',
    [
      '-y',
      '-ss',
      decimal(start),
      '-t',
      decimal(duration),
      '-i',
      wavPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ],
    options,
    'ASR_SEGMENT_FAILED',
  )
}

export async function probeDuration(path: string, options: ProcessOptions = {}): Promise<number> {
  const result = await runLoggedProcess(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    options,
  )
  const duration = Number(result.stdout.trim())
  if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) throw processError('MEDIA_PROBE_FAILED')
  return duration
}

export async function concatShotAudio(
  inputs: readonly { path: string; durationSec: number }[],
  outputPath: string,
  options: ProcessOptions = {},
): Promise<void> {
  if (inputs.length === 0) throw processError('TTS_AUDIO_MISSING')
  await mkdir(dirname(outputPath), { recursive: true })
  const args = ['-y']
  for (const input of inputs) args.push('-i', input.path)
  const filters = inputs.map(
    (input, index) =>
      `[${index}:a]aresample=48000,apad,atrim=0:${decimal(input.durationSec)},asetpts=N/SR/TB[a${index}]`,
  )
  filters.push(`${inputs.map((_input, index) => `[a${index}]`).join('')}concat=n=${inputs.length}:v=0:a=1[out]`)
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    outputPath,
  )
  await requireSuccess('ffmpeg', args, options, 'AUDIO_CONCAT_FAILED')
}

export async function muxVideoAudio(
  videoPath: string,
  audioPath: string | null,
  outputPath: string,
  options: ProcessOptions = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  if (!audioPath) {
    await copyFile(videoPath, outputPath)
    return
  }
  await requireSuccess(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-shortest',
      outputPath,
    ],
    options,
    'AUDIO_MUX_FAILED',
  )
}

export async function extractVideoFrames(
  videoPath: string,
  outputDir: string,
  durationSec: number,
  options: ProcessOptions = {},
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true })
  const positions = [0.05, Math.max(0.05, durationSec / 2), Math.max(0.05, durationSec - 0.05)]
  const paths: string[] = []
  for (const [index, position] of positions.entries()) {
    const path = join(outputDir, `${String(index).padStart(3, '0')}.png`)
    await requireSuccess(
      'ffmpeg',
      ['-y', '-ss', decimal(position), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=960:-2', path],
      options,
      'MEDIA_FRAME_FAILED',
    )
    paths.push(path)
  }
  return paths
}

async function requireSuccess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
  code: string,
): Promise<void> {
  const result = await runLoggedProcess(command, args, options)
  if (result.code !== 0) throw processError(code)
}

function parseSilences(stderr: string, durationSec: number): Array<{ startSec: number; endSec: number }> {
  const result: Array<{ startSec: number; endSec: number }> = []
  let start: number | undefined
  for (const line of stderr.split(/\r?\n/u)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/u)
    if (startMatch) start = Number(startMatch[1])
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/u)
    if (endMatch && start !== undefined) {
      result.push({ startSec: Math.max(0, start), endSec: Math.min(durationSec, Number(endMatch[1])) })
      start = undefined
    }
  }
  if (start !== undefined) result.push({ startSec: Math.max(0, start), endSec: durationSec })
  return result.filter((value) => value.endSec > value.startSec)
}

function splitSegment(startSec: number, endSec: number, maximumSec: number): SpeechSegment[] {
  const result: SpeechSegment[] = []
  for (let cursor = startSec; cursor < endSec; cursor += maximumSec) {
    result.push({ startMs: Math.round(cursor * 1000), endMs: Math.round(Math.min(endSec, cursor + maximumSec) * 1000) })
  }
  return result
}

function boundedAppend(current: string, value: string): string {
  const next = current + value
  return next.length <= 5_000_000 ? next : next.slice(-5_000_000)
}

function redactProcessText(value: string): string {
  return value
    .replace(/sk-[a-z0-9_-]{12,}/giu, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s]+/giu, 'authorization=[REDACTED]')
}

function processError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function decimal(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
