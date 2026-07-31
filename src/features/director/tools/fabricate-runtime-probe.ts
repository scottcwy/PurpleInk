import 'server-only'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { MASTER_HEIGHT, MASTER_WIDTH } from '@/features/canvas/contracts'
import {
  fabricatePageScriptViolation,
  inspectFabricateRuntimeContract,
  probeFabricateSeek,
  waitForFabricateFonts,
} from './fabricate-runtime-page'
import type {
  FabricateRuntimeProbeOptions,
  FabricateRuntimeViolation,
} from './fabricate-runtime-probe-contract'
import {
  createRuntimeProbeDeadline,
  runWithinProbeDeadline,
  type RuntimeProbeDeadline,
} from './runtime-probe-deadline'

export type {
  FabricateRuntimeProbe,
  FabricateRuntimeProbeOptions,
  FabricateRuntimeViolation,
} from './fabricate-runtime-probe-contract'

const DEFAULT_OPERATION_TIMEOUT_MS = 15_000
const DEFAULT_TOTAL_TIMEOUT_MS = 45_000

/** 在 Artifact 提交前用真实 Chromium 验证加载、母版几何与逐帧 seek。 */
export async function probeFabricateRuntime(
  source: string,
  options: FabricateRuntimeProbeOptions = {},
): Promise<FabricateRuntimeViolation[]> {
  options.signal?.throwIfAborted()
  const directory = await mkdtemp(path.join(
    options.tempRoot ?? os.tmpdir(),
    'purpleink-fabricate-',
  ))
  const htmlPath = path.join(directory, 'shot.html')
  try {
    options.signal?.throwIfAborted()
    await writeFile(htmlPath, source, 'utf8')
    options.signal?.throwIfAborted()
    return await probeHtmlPath(htmlPath, createRuntimeProbeDeadline({
      ...(options.signal ? { signal: options.signal } : {}),
      operationTimeoutMs: positiveTimeout(
        options.operationTimeoutMs,
        DEFAULT_OPERATION_TIMEOUT_MS,
      ),
      totalTimeoutMs: positiveTimeout(
        options.totalTimeoutMs,
        DEFAULT_TOTAL_TIMEOUT_MS,
      ),
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function probeHtmlPath(
  htmlPath: string,
  deadline: RuntimeProbeDeadline,
): Promise<FabricateRuntimeViolation[]> {
  deadline.signal?.throwIfAborted()
  const browser = await chromium.launch({
    headless: true,
    timeout: deadline.nextTimeout('total'),
  })
  const closeBrowser = () => {
    void browser.close().catch(() => undefined)
  }
  try {
    deadline.signal?.throwIfAborted()
    const page = await runWithinProbeDeadline(
      browser.newPage({
        viewport: { width: MASTER_WIDTH, height: MASTER_HEIGHT },
        deviceScaleFactor: 1,
      }),
      deadline,
      'page',
      closeBrowser,
      'total',
    )
    const pageScript = { failed: false }
    page.on('pageerror', () => {
      pageScript.failed = true
    })
    await runWithinProbeDeadline(
      page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' }),
      deadline,
      'load',
      closeBrowser,
      'total',
    )
    const fontsViolation = await waitForFabricateFonts(
      page,
      deadline,
      closeBrowser,
    )
    if (fontsViolation) return [fontsViolation]
    await page.waitForTimeout(0)
    if (pageScript.failed) return [fabricatePageScriptViolation()]

    const contractViolation = await inspectFabricateRuntimeContract(
      page,
      deadline,
      closeBrowser,
    )
    if (contractViolation) return [contractViolation]
    for (const frame of [0, 30]) {
      const seekViolation = await probeFabricateSeek(
        page,
        frame,
        deadline,
        closeBrowser,
      )
      if (seekViolation) return [seekViolation]
      await runWithinProbeDeadline(
        page.screenshot({ type: 'png' }),
        deadline,
        'screenshot',
        closeBrowser,
      )
      await page.waitForTimeout(0)
      if (pageScript.failed) return [fabricatePageScriptViolation()]
    }
    return []
  } finally {
    await browser.close()
  }
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback
}
