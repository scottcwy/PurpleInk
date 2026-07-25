import 'server-only'
import type { StorageAdapter } from '@/lib/storage'
import type { FrameCaptureSession } from './frame-capture'
import { assertDeterministicSource } from './source-contract'
import type { RenderJob } from './types'

export interface RenderAdmissionDependencies {
  storage: Pick<StorageAdapter, 'get' | 'localPath'>
  openFrameCapture(
    htmlPath: string,
    options: { width: number; height: number }
  ): Promise<FrameCaptureSession>
}

export async function assertRenderAdmission(
  job: RenderJob,
  dependencies: RenderAdmissionDependencies
): Promise<void> {
  const html = await readSource(job.htmlKey, dependencies.storage)
  assertDeterministicSource(html.toString('utf8'))
  const session = await openRuntime(job, dependencies)
  try {
    return
  } finally {
    await closeRuntime(session)
  }
}

async function readSource(
  htmlKey: string,
  storage: RenderAdmissionDependencies['storage']
): Promise<Buffer> {
  try {
    return await storage.get(htmlKey)
  } catch {
    throw new Error('渲染 source 读取失败')
  }
}

async function openRuntime(
  job: RenderJob,
  dependencies: RenderAdmissionDependencies
): Promise<FrameCaptureSession> {
  try {
    return await dependencies.openFrameCapture(
      dependencies.storage.localPath(job.htmlKey),
      {
        width: job.frames.width,
        height: job.frames.height,
      }
    )
  } catch (error) {
    throw new Error(safeRuntimeMessage(error))
  }
}

async function closeRuntime(session: FrameCaptureSession): Promise<void> {
  try {
    await session.close()
  } catch {
    throw new Error('渲染 runtime session 关闭失败')
  }
}

function safeRuntimeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (
    message === 'shot 缺少 window.__CVC_RENDER__ runtime' ||
    message === '__CVC_RENDER__.seek 必须是函数' ||
    /^__CVC_RENDER__ runtime version 不匹配：[A-Za-z0-9._-]{1,32} != 1$/.test(
      message
    )
  ) {
    return message
  }
  return '渲染 runtime admission 失败'
}
