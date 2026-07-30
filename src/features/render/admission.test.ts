import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { FrameCaptureSession } from './frame-capture'
import {
  assertRenderAdmission,
  isRenderSourceContractError,
} from './admission'
import type { RenderJob } from './types'

vi.mock('server-only', () => ({}))

const renderJob: RenderJob = {
  projectId: 'project-1',
  nodeId: 'node-1',
  shotId: 'S001',
  htmlKey: 'director/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
}

const VALID_SOURCE = `<!doctype html><html><head>
<meta name="viewport" content="width=1920, height=1080"></head>
<body><main data-composition-id="shot" data-width="1920" data-height="1080"></main></body>
</html>`

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
        storage: storageOf(`${VALID_SOURCE}\n<script>requestAnimationFrame(render)</script>`),
        openFrameCapture,
      })
    ).rejects.toThrow('确定性违规：raf@5')
    expect(openFrameCapture).not.toHaveBeenCalled()
  })

  it.each([
    ['shot 缺少 window.__CVC_RENDER__ runtime', 'shot 缺少 window.__CVC_RENDER__ runtime'],
    ['__CVC_RENDER__ runtime version 不匹配：2 != 1', '__CVC_RENDER__ runtime version 不匹配：2 != 1'],
    ['shot 页面脚本执行失败', 'shot 页面脚本执行失败'],
    ['母版画布几何不匹配：root=null×null', '母版画布几何不匹配'],
  ])('propagates runtime admission failure: %s', async (message, expected) => {
    const openFrameCapture = vi.fn(async () => {
      throw new Error(message)
    })

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf(VALID_SOURCE),
        openFrameCapture,
      })
    ).rejects.toThrow(expected)
  })

  it('recognizes a source contract failure through a renderer wrapper cause', () => {
    const contractFailure = new Error('shot 页面脚本执行失败')
    const wrapped = new Error('打开截图 session 失败', { cause: contractFailure })

    expect(isRenderSourceContractError(wrapped)).toBe(true)
    expect(isRenderSourceContractError(new Error('browser process unavailable'))).toBe(false)
  })

  it('closes a successfully validated runtime session', async () => {
    const close = vi.fn(async () => {})
    const openFrameCapture = vi.fn(async () => captureSession(close))

    await assertRenderAdmission(renderJob, {
      storage: storageOf(VALID_SOURCE),
      openFrameCapture,
    })

    expect(openFrameCapture).toHaveBeenCalledWith('trusted-shot.html', {
      width: 1920,
      height: 1080,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not expose local paths from storage or browser failures', async () => {
    const sourceStorage = storageOf(VALID_SOURCE)
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
        storage: storageOf(VALID_SOURCE),
        openFrameCapture: vi.fn(async () => {
          throw new Error('browser failed at C:\\private\\source.html')
        }),
      })
    ).rejects.toMatchObject({ message: '渲染 runtime admission 失败' })

    await expect(
      assertRenderAdmission(renderJob, {
        storage: storageOf(VALID_SOURCE),
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
