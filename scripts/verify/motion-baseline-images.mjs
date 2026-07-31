import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises'
import path from 'node:path'

import { Jimp } from 'jimp'

import {
  MOTION_ACTUAL_DIRECTORY,
  MOTION_BASELINE_DIRECTORY,
  MOTION_PIXEL_DIFF_LIMIT,
} from './motion-baseline-targets.mjs'

async function pngNames(directory) {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.png'))
    .sort()
}

async function imageDifferenceRatio(actualPath, baselinePath) {
  const [actual, baseline] = await Promise.all([
    Jimp.read(await readFile(actualPath)),
    Jimp.read(await readFile(baselinePath)),
  ])
  if (
    actual.bitmap.width !== baseline.bitmap.width
    || actual.bitmap.height !== baseline.bitmap.height
  ) {
    return {
      ratio: 1,
      detail:
        `${actual.bitmap.width}x${actual.bitmap.height} vs `
        + `${baseline.bitmap.width}x${baseline.bitmap.height}`,
    }
  }

  let differentPixels = 0
  const actualBytes = actual.bitmap.data
  const baselineBytes = baseline.bitmap.data
  for (let offset = 0; offset < actualBytes.length; offset += 4) {
    if (
      actualBytes[offset] !== baselineBytes[offset]
      || actualBytes[offset + 1] !== baselineBytes[offset + 1]
      || actualBytes[offset + 2] !== baselineBytes[offset + 2]
      || actualBytes[offset + 3] !== baselineBytes[offset + 3]
    ) {
      differentPixels += 1
    }
  }

  const pixelCount = actual.bitmap.width * actual.bitmap.height
  return {
    ratio: differentPixels / pixelCount,
    detail: `${differentPixels}/${pixelCount} pixels`,
  }
}

export async function injectMotionBaselineDifference(notes) {
  const [firstName] = await pngNames(MOTION_ACTUAL_DIRECTORY)
  const targetPath = path.join(MOTION_ACTUAL_DIRECTORY, firstName)
  const image = await Jimp.read(await readFile(targetPath))
  const pixelCount = image.bitmap.width * image.bitmap.height
  const changedPixels = Math.ceil(pixelCount * 0.02)
  for (let pixel = 0; pixel < changedPixels; pixel += 1) {
    const offset = pixel * 4
    image.bitmap.data[offset] = 255 - image.bitmap.data[offset]
    image.bitmap.data[offset + 1] = 255 - image.bitmap.data[offset + 1]
    image.bitmap.data[offset + 2] = 255 - image.bitmap.data[offset + 2]
  }
  await image.write(targetPath)
  notes.push(`self-test: ${firstName} 人为改动 ${changedPixels} pixels`)
}

export async function compareMotionBaseline(notes, problems) {
  let actualNames
  let baselineNames
  try {
    ;[actualNames, baselineNames] = await Promise.all([
      pngNames(MOTION_ACTUAL_DIRECTORY),
      pngNames(MOTION_BASELINE_DIRECTORY),
    ])
  } catch {
    problems.push(
      `缺少基线目录 ${MOTION_BASELINE_DIRECTORY}；请显式运行 pnpm verify:motion:update`,
    )
    return
  }

  if (actualNames.join('\n') !== baselineNames.join('\n')) {
    problems.push(
      `基线文件清单不一致：actual=[${actualNames.join(', ')}] `
      + `baseline=[${baselineNames.join(', ')}]`,
    )
    return
  }

  for (const name of actualNames) {
    const { ratio, detail } = await imageDifferenceRatio(
      path.join(MOTION_ACTUAL_DIRECTORY, name),
      path.join(MOTION_BASELINE_DIRECTORY, name),
    )
    notes.push(`${name}: diff=${(ratio * 100).toFixed(4)}% (${detail})`)
    if (ratio > MOTION_PIXEL_DIFF_LIMIT) {
      problems.push(
        `${name} 差异 ${(ratio * 100).toFixed(4)}% 超过 `
        + `${(MOTION_PIXEL_DIFF_LIMIT * 100).toFixed(2)}%`,
      )
    }
  }
}

export async function updateMotionBaseline(notes) {
  await mkdir(path.dirname(MOTION_BASELINE_DIRECTORY), { recursive: true })
  await rm(MOTION_BASELINE_DIRECTORY, { recursive: true, force: true })
  await cp(MOTION_ACTUAL_DIRECTORY, MOTION_BASELINE_DIRECTORY, {
    recursive: true,
  })
  notes.push(`已显式更新 ${MOTION_BASELINE_DIRECTORY}`)
}
