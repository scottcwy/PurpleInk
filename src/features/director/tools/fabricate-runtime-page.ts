import type { Page } from 'playwright'
import { MASTER_HEIGHT, MASTER_WIDTH } from '@/features/canvas/contracts'
import type { FabricateRuntimeViolation } from './fabricate-runtime-probe-contract'
import {
  runWithinProbeDeadline,
  RuntimeProbeTimeoutError,
  type RuntimeProbeDeadline,
} from './runtime-probe-deadline'

export async function waitForFabricateFonts(
  page: Page,
  deadline: RuntimeProbeDeadline,
  closeBrowser: () => void,
): Promise<FabricateRuntimeViolation | null> {
  try {
    await runWithinProbeDeadline(
      page.evaluate(async () => {
        await document.fonts.ready
      }),
      deadline,
      'fonts',
      closeBrowser,
    )
    return null
  } catch (error) {
    if (error instanceof RuntimeProbeTimeoutError) {
      return {
        ruleId: 'runtime-fonts-timeout',
        message: '字体加载未能完成',
      }
    }
    throw error
  }
}

export async function inspectFabricateRuntimeContract(
  page: Page,
  deadline: RuntimeProbeDeadline,
  closeBrowser: () => void,
): Promise<FabricateRuntimeViolation | null> {
  const contract = await runWithinProbeDeadline(
    page.evaluate(() => {
      const runtime = (
        window as unknown as {
          __CVC_RENDER__?: { version?: unknown; seek?: unknown }
        }
      ).__CVC_RENDER__
      const root = document.querySelector<HTMLElement>('[data-composition-id]')
      const rect = root?.getBoundingClientRect()
      return {
        runtimeExists: runtime !== undefined,
        runtimeVersion: runtime?.version,
        hasSeek: typeof runtime?.seek === 'function',
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        rootWidth: rect?.width ?? null,
        rootHeight: rect?.height ?? null,
        rootLeft: rect?.left ?? null,
        rootTop: rect?.top ?? null,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }
    }),
    deadline,
    'contract',
    closeBrowser,
  )
  if (!contract.runtimeExists) {
    return { ruleId: 'runtime-missing', message: '缺少逐帧渲染 runtime' }
  }
  if (contract.runtimeVersion !== 1) {
    return { ruleId: 'runtime-version', message: '逐帧渲染 runtime 版本不匹配' }
  }
  if (!contract.hasSeek) {
    return { ruleId: 'runtime-seek', message: '逐帧渲染 runtime 缺少 seek 函数' }
  }
  const geometryMatches =
    contract.viewportWidth === MASTER_WIDTH &&
    contract.viewportHeight === MASTER_HEIGHT &&
    contract.rootWidth === MASTER_WIDTH &&
    contract.rootHeight === MASTER_HEIGHT &&
    contract.rootLeft === 0 &&
    contract.rootTop === 0 &&
    contract.scrollWidth <= MASTER_WIDTH &&
    contract.scrollHeight <= MASTER_HEIGHT
  return geometryMatches
    ? null
    : {
        ruleId: 'runtime-master-geometry',
        message: '母版画布几何不匹配',
      }
}

export async function probeFabricateSeek(
  page: Page,
  frame: number,
  deadline: RuntimeProbeDeadline,
  closeBrowser: () => void,
): Promise<FabricateRuntimeViolation | null> {
  let outcome: string
  try {
    outcome = await runWithinProbeDeadline(
      page.evaluate(async ({ targetFrame }) => {
        const runtime = (
          window as unknown as {
            __CVC_RENDER__: {
              seek(frame: number, fps: number): unknown | Promise<unknown>
            }
          }
        ).__CVC_RENDER__
        try {
          await runtime.seek(targetFrame, 30)
          return 'ok'
        } catch {
          return 'source-error'
        }
      }, { targetFrame: frame }),
      deadline,
      'seek',
      closeBrowser,
    )
  } catch (error) {
    if (error instanceof RuntimeProbeTimeoutError) {
      return {
        ruleId: 'runtime-seek-timeout',
        message: '逐帧 seek 执行超时',
      }
    }
    throw error
  }
  return outcome === 'source-error'
    ? {
        ruleId: 'runtime-seek-script',
        message: '逐帧 seek 脚本执行失败',
      }
    : null
}

export function fabricatePageScriptViolation(): FabricateRuntimeViolation {
  return {
    ruleId: 'runtime-page-script',
    message: '页面脚本执行失败',
  }
}
