import 'server-only'
import { createHash } from 'node:crypto'
import { Jimp } from 'jimp'
import { readArtifact } from '@/features/artifacts'
import { captureThumbnails } from './thumbnail'
import { RenderRepository, type ShotQaTarget } from './repository'
import type {
  ShotQaCheckData,
  ThumbnailContext,
  ThumbnailQaResult,
  ThumbnailResult,
} from './types'

/**
 * Final QA 抽帧检测（渲染/截帧后的像素内容分析）。
 * 与 lib/determinism（渲染前的源码文本静态守卫）是完全不同维度的检测，故独立成模块。
 * 纯函数 checkThumbnailQa 无副作用、可单测（测试需 vi.mock('server-only')）。
 */

/** 平均亮度低于此阈值判为黑帧（0-255 量程，约 3%）。经验起始值，可据真实误报率调整。 */
export const BLACK_FRAME_LUMINANCE_THRESHOLD = 8

/** 亮度标准差低于此阈值且非黑帧判为疑似纯色/无实质内容。经验起始值，可据真实误报率调整。 */
export const SOLID_COLOR_STDDEV_THRESHOLD = 2

/** QA 抽帧的时间百分比（与 25% / 60% / 95% 三态联系表对应）。 */
export const QA_THUMBNAIL_FRACTIONS = [0.25, 0.6, 0.95] as const

/**
 * 对单张缩略图运行最小规则检测：亮度均值判黑帧、亮度标准差判纯色。
 * 纯函数（仅依赖 jimp 解码），无 DB/存储副作用。
 */
export async function checkThumbnailQa(
  imageBuffer: Buffer,
  label: string
): Promise<ThumbnailQaResult> {
  const image = await Jimp.read(imageBuffer)
  const { data, width, height } = image.bitmap
  const pixelCount = width * height
  if (pixelCount === 0) {
    return {
      label,
      meanLuminance: 0,
      luminanceStdDev: 0,
      isBlackFrame: true,
      isNearSolidColor: false,
      passed: false,
    }
  }

  const luminances = new Float64Array(pixelCount)
  let sum = 0
  for (let i = 0, p = 0; p < pixelCount; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    luminances[p] = lum
    sum += lum
  }
  const meanLuminance = sum / pixelCount

  let variance = 0
  for (let p = 0; p < pixelCount; p++) {
    const delta = luminances[p] - meanLuminance
    variance += delta * delta
  }
  const luminanceStdDev = Math.sqrt(variance / pixelCount)

  const isBlackFrame = meanLuminance < BLACK_FRAME_LUMINANCE_THRESHOLD
  const isNearSolidColor = !isBlackFrame && luminanceStdDev < SOLID_COLOR_STDDEV_THRESHOLD
  return {
    label,
    meanLuminance,
    luminanceStdDev,
    isBlackFrame,
    isNearSolidColor,
    passed: !isBlackFrame && !isNearSolidColor,
  }
}

/** 编排依赖，可注入以便单测；默认走真实 repository / 缩略图 / artifact 读取。 */
export interface ShotQaDependencies {
  repository: Pick<
    RenderRepository,
    'getShotQaTargets' | 'loadCompletedThumbnailContext' | 'readShotQaCheck' | 'writeShotQaCheck'
  >
  capture: typeof captureThumbnails
  readArtifactBytes: (projectId: string, artifactId: string) => Promise<Buffer>
  check: typeof checkThumbnailQa
  now: () => number
}

function defaultDependencies(): ShotQaDependencies {
  return {
    repository: new RenderRepository(),
    capture: captureThumbnails,
    readArtifactBytes: async (projectId, artifactId) =>
      (await readArtifact(projectId, artifactId)).bytes,
    check: checkThumbnailQa,
    now: () => Date.now(),
  }
}

/**
 * 对项目内全部「已成功渲染 shot-codegen + 同 laneKey shot-qa」目标运行 QA：
 * 产出/复用 25%/60%/95% 缩略图 → 逐张规则检测 → 写回 shot-qa 节点 data.qaCheck。
 * 若缩略图 contentHash 聚合未变则跳过重算。逐 shot best-effort，单个失败不中断其余。
 * 本检测刻意不经过 Director/LLM 六阶段管线（确定性规则，无需模型）。
 */
export async function runShotQaChecks(
  projectId: string,
  deps: Partial<ShotQaDependencies> = {}
): Promise<void> {
  const dependencies = { ...defaultDependencies(), ...deps }
  const targets = await dependencies.repository.getShotQaTargets(projectId)
  for (const target of targets) {
    try {
      await runOneShotQa(projectId, target, dependencies)
    } catch (error) {
      console.error(
        `[qa-check] 分镜 ${target.laneKey} QA 检测失败：${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}

/** 对单个 shot-qa 节点严格执行规则 QA；前置条件或检测失败直接交给阶段状态机。 */
export async function runShotQaCheck(
  projectId: string,
  qaNodeId: string,
  deps: Partial<ShotQaDependencies> = {}
): Promise<ShotQaCheckData> {
  const dependencies = { ...defaultDependencies(), ...deps }
  const target = (
    await dependencies.repository.getShotQaTargets(projectId)
  ).find((candidate) => candidate.qaNodeId === qaNodeId)
  if (!target) {
    throw new Error(`shot-qa 节点不具备 QA 前置条件：${qaNodeId}`)
  }
  return runOneShotQa(projectId, target, dependencies)
}

async function runOneShotQa(
  projectId: string,
  target: ShotQaTarget,
  dependencies: ShotQaDependencies
): Promise<ShotQaCheckData> {
  const context: ThumbnailContext = await dependencies.repository.loadCompletedThumbnailContext(
    projectId,
    target.codegenNodeId
  )
  const thumbnails = await dependencies.capture(
    context,
    QA_THUMBNAIL_FRACTIONS.map((fraction) => ({ fraction }))
  )
  const thumbnailContentHash = aggregateHash(thumbnails)

  const existing = await dependencies.repository.readShotQaCheck(target.qaNodeId)
  if (existing && existing.thumbnailContentHash === thumbnailContentHash) {
    return existing
  }

  const results: ThumbnailQaResult[] = []
  for (const thumbnail of thumbnails) {
    const bytes = await dependencies.readArtifactBytes(projectId, thumbnail.artifactId)
    results.push(await dependencies.check(bytes, labelForFraction(thumbnail.fraction)))
  }

  const qaCheck = {
    passed: results.every((result) => result.passed),
    checkedAt: dependencies.now(),
    thumbnailContentHash,
    results,
  } satisfies ShotQaCheckData
  await dependencies.repository.writeShotQaCheck(target.qaNodeId, qaCheck)
  return qaCheck
}

/** 由本批缩略图 contentHash 派生聚合键，任一帧变化都会得到不同键。 */
function aggregateHash(thumbnails: readonly ThumbnailResult[]): string {
  return createHash('sha256')
    .update(thumbnails.map((thumbnail) => thumbnail.contentHash).join('\0'))
    .digest('hex')
}

function labelForFraction(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
