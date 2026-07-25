import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { FrameCaptureSession } from './frame-capture'
import { assertRenderAdmission } from './admission'
import type { RenderJob } from './types'

vi.mock('server-only', () => ({}))

const renderJob: RenderJob = {
  projectId: 'project-1',
  nodeId: 'node-1',
  shotId: 'S001',
  htmlKey: 'director/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
}

function storageOf(source: string): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async () => Buffer.from(source)),
    exists: vi.fn(),
    localPath: vi.fn(() => 'trusted-shot.html'),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

function captureSession(close = vi.fn(async () => {})): FrameCaptureSession {
  return {
    capture: vi.fn(),
    close,
  }
}

describe('assertRenderAdmission', () => {
  it('rejects forbidden source before opening a browser session', async () => {
    const openFrameCapture = vi.fn()

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf('requestAnimationFrame(render)'),
        openFrameCapture,
      })
    ).rejects.toThrow('确定性违规：raf@1')
    expect(openFrameCapture).not.toHaveBeenCalled()
  })

  it.each([
    'shot 缺少 window.__CVC_RENDER__ runtime',
    '__CVC_RENDER__ runtime version 不匹配：2 != 1',
  ])('propagates runtime admission failure: %s', async (message) => {
    const openFrameCapture = vi.fn(async () => {
      throw new Error(message)
    })

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf('<html>deterministic</html>'),
        openFrameCapture,
      })
    ).rejects.toThrow(message)
  })

  it('closes a successfully validated runtime session', async () => {
    const close = vi.fn(async () => {})
    const openFrameCapture = vi.fn(async () => captureSession(close))

    await assertRenderAdmission(renderJob, {
      storage: storageOf('<html>deterministic</html>'),
      openFrameCapture,
    })

    expect(openFrameCapture).toHaveBeenCalledWith('trusted-shot.html', {
      width: 1920,
      height: 1080,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not expose local paths from storage or browser failures', async () => {
    const sourceStorage = storageOf('<html>deterministic</html>')
    vi.mocked(sourceStorage.get).mockRejectedValueOnce(
      new Error('ENOENT: C:\\private\\source.html')
    )

    await expect(
      assertRenderAdmission(renderJob, {
        storage: sourceStorage,
        openFrameCapture: vi.fn(),
      })
    ).rejects.toMatchObject({ message: '渲染 source 读取失败' })

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf('<html>deterministic</html>'),
        openFrameCapture: vi.fn(async () => {
          throw new Error('browser failed at C:\\private\\source.html')
        }),
      })
    ).rejects.toMatchObject({ message: '渲染 runtime admission 失败' })

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf('<html>deterministic</html>'),
        openFrameCapture: vi.fn(async () =>
          captureSession(
            vi.fn(async () => {
              throw new Error('close failed at C:\\private\\source.html')
            })
          )
        ),
      })
    ).rejects.toMatchObject({ message: '渲染 runtime session 关闭失败' })
  })
})
