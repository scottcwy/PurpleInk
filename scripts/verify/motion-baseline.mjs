import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { chromium } from 'playwright'

import { MOTION_INTENT_COUNT } from '../../src/app/playbook/motion/motion-intents.ts'
import {
  compareMotionBaseline,
  injectMotionBaselineDifference,
  updateMotionBaseline,
} from './motion-baseline-images.mjs'
import {
  EXPECTED_DURATION_STYLES,
  EXPECTED_EASING_STYLES,
  MOTION_ACTUAL_DIRECTORY,
  MOTION_BASE_URL,
  MOTION_BASELINE_TARGETS,
  MOTION_VIEWPORT,
} from './motion-baseline-targets.mjs'

const UPDATE_BASELINE = process.argv.includes('--update')
const SELF_TEST_DIFFERENCE = process.argv.includes('--self-test-difference')
const problems = []
const notes = []

// 已在 prepareStablePage 显式等待并检查字体状态，关闭 Playwright 截图内部的第二次
// 无界等待，避免字体状态在超长 playbook 页面截图时重新抖动到 pending。
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1'

function recordPageProblems(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text()
      const expectedReducedMotionNotice =
        target.reducedMotion === 'reduce'
        && text.includes('Reduced Motion enabled on your device')
      const expectedDevThemeBootstrapNotice =
        text.includes('Encountered a script tag while rendering React component')
      const expectedMarketingWebGlReadbackNotice =
        target.route === '/'
        && message.type() === 'warning'
        && text.includes('GL Driver Message')
        && text.includes('ReadPixels')
      if (
        expectedReducedMotionNotice
        || expectedDevThemeBootstrapNotice
        || expectedMarketingWebGlReadbackNotice
      ) {
        notes.push(`${target.id} expected framework diagnostic: ${text}`)
        return
      }
      problems.push(
        `${target.id} console.${message.type()}: ${text}`,
      )
    }
  })
  page.on('requestfailed', (request) => {
    problems.push(`${target.id} requestfailed: ${request.url()}`)
  })
}

async function prepareStablePage(page, target) {
  await page.waitForFunction(
    () => document.fonts.status === 'loaded',
    undefined,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(450)
  await page.addStyleTag({
    content: `
      html { scroll-behavior: auto !important; }
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
      nextjs-portal { display: none !important; }
      ${target.route === '/'
    ? 'canvas.pointer-events-none.mix-blend-multiply { visibility: hidden !important; }'
    : ''}
    `,
  })
}

async function captureTarget(browser, target) {
  const context = await browser.newContext({
    viewport: MOTION_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: target.theme,
    reducedMotion: target.reducedMotion,
  })
  await context.addInitScript((theme) => {
    localStorage.setItem('theme-mode', theme)
  }, target.theme)

  const page = await context.newPage()
  recordPageProblems(page, target)
  const response = await page.goto(new URL(target.route, MOTION_BASE_URL).href, {
    waitUntil: 'networkidle',
  })
  if (response?.status() !== 200) {
    problems.push(`${target.id} status=${response?.status() ?? 'none'}`)
  }
  await prepareStablePage(page, target)

  const outputPath = path.join(MOTION_ACTUAL_DIRECTORY, `${target.id}.png`)
  await page.screenshot({ path: outputPath, fullPage: true })
  const { size } = await stat(outputPath)
  notes.push(`${target.id}: ${(size / 1024).toFixed(1)} KiB`)

  await page.close()
  await context.close()
}

async function readComputedStyles(page, property, classNames) {
  return page.evaluate(
    ({ names, styleProperty }) => {
      const result = {}
      for (const className of names) {
        const element = document.querySelector(`.${className}`)
        result[className] = element
          ? getComputedStyle(element)[styleProperty]
          : null
      }
      return result
    },
    { names: classNames, styleProperty: property },
  )
}

function assertStyleMap(actual, expected, label) {
  for (const [className, wanted] of Object.entries(expected)) {
    const resolved = actual[className]
    if (resolved === null) {
      problems.push(`${label}: 找不到 .${className}`)
    } else if (!resolved.includes(wanted)) {
      problems.push(`${label}: .${className}=${resolved}，期望含 ${wanted}`)
    } else {
      notes.push(`${label}: .${className} -> ${resolved}`)
    }
  }
}

async function assertBrowserContracts(browser) {
  const context = await browser.newContext({ viewport: MOTION_VIEWPORT })
  const page = await context.newPage()
  const target = { id: 'computed-style-contracts' }
  recordPageProblems(page, target)

  await page.goto(
    new URL('/playbook/foundations', MOTION_BASE_URL).href,
    { waitUntil: 'networkidle' },
  )
  const durations = await readComputedStyles(
    page,
    'transitionDuration',
    Object.keys(EXPECTED_DURATION_STYLES),
  )
  const easings = await readComputedStyles(
    page,
    'transitionTimingFunction',
    Object.keys(EXPECTED_EASING_STYLES),
  )
  assertStyleMap(durations, EXPECTED_DURATION_STYLES, 'duration')
  assertStyleMap(easings, EXPECTED_EASING_STYLES, 'easing')

  await page.goto(new URL('/playbook/motion', MOTION_BASE_URL).href, {
    waitUntil: 'networkidle',
  })
  const cardCount = await page.locator('article').count()
  if (cardCount !== MOTION_INTENT_COUNT) {
    problems.push(
      `意图卡片数=${cardCount}，登记表 MOTION_INTENT_COUNT=${MOTION_INTENT_COUNT}`,
    )
  } else {
    notes.push(`意图卡片数=${cardCount}`)
  }
  const unregisteredCount = await page.getByText('标本未登记').count()
  if (unregisteredCount > 0) {
    problems.push(`存在未登记标本 ${unregisteredCount} 处`)
  }

  await page.close()
  await context.close()

  const reducedContext = await browser.newContext({
    viewport: MOTION_VIEWPORT,
    reducedMotion: 'reduce',
  })
  const reducedPage = await reducedContext.newPage()
  await reducedPage.goto(
    new URL('/playbook/foundations', MOTION_BASE_URL).href,
    { waitUntil: 'networkidle' },
  )
  const reduced = await reducedPage.evaluate(() => {
    const element = document.querySelector('.duration-base')
    return element ? getComputedStyle(element).transitionDuration : null
  })
  const reducedSeconds = reduced?.trim().endsWith('ms')
    ? Number.parseFloat(reduced) / 1000
    : Number.parseFloat(reduced ?? 'NaN')
  if (!(reducedSeconds >= 0 && reducedSeconds <= 0.001)) {
    problems.push(
      `reduced-motion: .duration-base=${reduced}，期望不超过 1ms`,
    )
  } else {
    notes.push(`reduced-motion: .duration-base -> ${reduced}`)
  }
  await reducedPage.close()
  await reducedContext.close()
}

if (UPDATE_BASELINE && SELF_TEST_DIFFERENCE) {
  throw new Error('--update 与 --self-test-difference 不可同时使用')
}

await rm(MOTION_ACTUAL_DIRECTORY, { recursive: true, force: true })
await mkdir(MOTION_ACTUAL_DIRECTORY, { recursive: true })

const browser = await chromium.launch()
try {
  for (const target of MOTION_BASELINE_TARGETS) {
    await captureTarget(browser, target)
  }
  await assertBrowserContracts(browser)
} finally {
  await browser.close()
}

if (problems.length === 0 && SELF_TEST_DIFFERENCE) {
  await injectMotionBaselineDifference(notes)
}
if (problems.length === 0) {
  if (UPDATE_BASELINE) {
    await updateMotionBaseline(notes)
  } else {
    await compareMotionBaseline(notes, problems)
  }
}

console.log(`MOTION BASELINE NOTES:\n${notes.join('\n')}`)
if (problems.length > 0) {
  console.error(`MOTION BASELINE PROBLEMS:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(
  UPDATE_BASELINE
    ? 'OK: 动效基线已显式更新，浏览器合同通过'
    : 'OK: 动效基线差异在阈值内，浏览器合同通过',
)
