import 'server-only'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import { MASTER_HEIGHT, MASTER_WIDTH } from '@/features/canvas/contracts'

/** 按序流拷贝分镜视频；配乐可选且不会触发视频重编码。 */
export async function concatExport(
  mp4Paths: string[],
  musicPath: string | null,
  outputPath: string,
  targetResolution: { width: number; height: number } | null = null
): Promise<string> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  if (mp4Paths.length === 0) throw new Error('concat 至少需要一个分镜 mp4')
  await assertInputs(mp4Paths, musicPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const workDirectory = await mkdtemp(path.join(path.dirname(outputPath), '.cvc-concat-'))
  const listPath = path.join(workDirectory, 'shots.ffconcat')
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.tmp-${randomUUID()}.mp4`
  )
  try {
    const list = [
      'ffconcat version 1.0',
      ...mp4Paths.map((file) => `file '${escapeConcatPath(file)}'`),
    ].join('\n')
    await writeFile(listPath, `${list}\n`, 'utf8')
    await runFfmpeg(buildArgs(listPath, musicPath, temporaryPath, targetResolution))
    await rename(temporaryPath, outputPath)
    return outputPath
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

async function assertInputs(
  mp4Paths: string[],
  musicPath: string | null
): Promise<void> {
  for (const [index, file] of mp4Paths.entries()) {
    try {
      await stat(file)
    } catch (error) {
      throw new Error(`concat 分镜索引 ${index} 的文件不存在：${file}`, {
        cause: error,
      })
    }
  }
  if (musicPath) {
    try {
      await stat(musicPath)
    } catch (error) {
      throw new Error(`concat 配乐文件不存在：${musicPath}`, { cause: error })
    }
  }
}

function buildArgs(
  listPath: string,
  musicPath: string | null,
  outputPath: string,
  targetResolution: { width: number; height: number } | null
): string[] {
  // 仅当目标分辨率 ≠ 母版时才重编码；默认/母版分辨率保持 -c:v copy 无损快路径（零回归）。
  const needsScale =
    targetResolution !== null &&
    (targetResolution.width !== MASTER_WIDTH || targetResolution.height !== MASTER_HEIGHT)

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
  ]
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath)

  args.push('-map', '0:v:0')
  if (musicPath) args.push('-map', '1:a:0')

  if (needsScale && targetResolution) {
    args.push(
      '-vf',
      `scale=${targetResolution.width}:${targetResolution.height}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20'
    )
  } else {
    args.push('-c:v', 'copy')
  }

  if (musicPath) args.push('-c:a', 'aac', '-shortest')
  else args.push('-an')

  args.push('-map_metadata', '-1', '-movflags', '+faststart', '-y', outputPath)
  return args
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      reject(new Error(`ffmpeg concat 启动失败：${error.message}`, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg concat 失败（exit ${String(code)}）：${stderr.trim()}`))
    })
  })
}

function escapeConcatPath(file: string): string {
  if (/[\r\n]/.test(file)) throw new Error('concat 文件路径不能包含换行')
  return path.resolve(file).replaceAll('\\', '/').replaceAll("'", "'\\''")
}
