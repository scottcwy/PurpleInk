import 'server-only'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'

const RUNTIME_VERSION = 1

export interface FrameCaptureOptions {
  width?: number
  height?: number
}

export interface FrameCaptureSession {
  capture(frame: number, fps: number): Promise<Buffer>
  close(): Promise<void>
}

/** 打开一次 shot 页面并复用，调用方必须 close。 */
export async function openFrameCapture(
  htmlPath: string,
  options: FrameCaptureOptions = {}
): Promise<FrameCaptureSession> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: {
        width: options.width ?? 1920,
        height: options.height ?? 1080,
      },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await assertRuntime(page)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Page.enable')
    return createSession(browser, context, page, cdp)
  } catch (error) {
    await browser.close()
    throw error
  }
}

/** 单帧便捷入口；即使截图失败也会关闭浏览器。 */
export async function captureFrame(
  htmlPath: string,
  frame: number,
  fps: number
): Promise<Buffer> {
  const session = await openFrameCapture(htmlPath)
  try {
    return await session.capture(frame, fps)
  } finally {
    await session.close()
  }
}

function createSession(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  cdp: CDPSession
): FrameCaptureSession {
  let closed = false
  return {
    async capture(frame, fps) {
      if (closed) throw new Error('FrameCaptureSession 已关闭')
      validateFrame(frame, fps)
      await seekRuntime(page, frame, fps)
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      return Buffer.from(screenshot.data, 'base64')
    },
    async close() {
      if (closed) return
      closed = true
      await cdp.detach().catch(() => undefined)
      await context.close().catch(() => undefined)
      await browser.close()
    },
  }
}

async function assertRuntime(page: Page): Promise<void> {
  const runtime = await page.evaluate(() => {
    const value = (
      window as unknown as {
        __CVC_RENDER__?: { version?: unknown; seek?: unknown }
      }
    ).__CVC_RENDER__
    return {
      exists: value !== undefined,
      version: value?.version,
      hasSeek: typeof value?.seek === 'function',
    }
  })
  if (!runtime.exists) throw new Error('shot 缺少 window.__CVC_RENDER__ runtime')
  if (runtime.version !== RUNTIME_VERSION) {
    throw new Error(
      `__CVC_RENDER__ runtime version 不匹配：${String(runtime.version)} != ${RUNTIME_VERSION}`
    )
  }
  if (!runtime.hasSeek) throw new Error('__CVC_RENDER__.seek 必须是函数')
}

async function seekRuntime(page: Page, frame: number, fps: number): Promise<void> {
  await page.evaluate(
    async ({ targetFrame, targetFps }) => {
      const runtime = (
        window as unknown as {
          __CVC_RENDER__: {
            seek(frame: number, fps: number): unknown | Promise<unknown>
          }
        }
      ).__CVC_RENDER__
      await runtime.seek(targetFrame, targetFps)
    },
    { targetFrame: frame, targetFps: fps }
  )
}

function validateFrame(frame: number, fps: number): void {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`frame 必须是非负整数：${frame}`)
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps 必须大于 0：${fps}`)
  }
}
