import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { probeFabricateRuntime } from './fabricate-runtime-probe'

vi.mock('server-only', () => ({}))

const VALID_SOURCE = `<!doctype html>
<html><head>
<meta name="viewport" content="width=1920, height=1080">
<style>
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
* { box-sizing: border-box; }
[data-composition-id] { width: 1920px; height: 1080px; overflow: hidden; }
</style></head><body>
<main data-composition-id="shot" data-width="1920" data-height="1080"></main>
<script>
window.__CVC_RENDER__ = { version: 1, seek() {} };
</script></body></html>`

describe('probeFabricateRuntime', () => {
  it('accepts a runtime-safe 1920×1080 source', async () => {
    await expect(probeFabricateRuntime(VALID_SOURCE)).resolves.toEqual([])
  }, 15_000)

  it('rejects computed master geometry overflow', async () => {
    const source = VALID_SOURCE.replace(
      '* { box-sizing: border-box; }',
      '[data-composition-id] { padding: 52px; box-sizing: content-box; }',
    )

    await expect(probeFabricateRuntime(source)).resolves.toContainEqual({
      ruleId: 'runtime-master-geometry',
      message: '母版画布几何不匹配',
    })
  }, 15_000)

  it('rejects load-time and seek-time page script errors', async () => {
    const loadError = VALID_SOURCE.replace(
      '</script>',
      'missingLoadIdentifier();</script>',
    )
    const seekError = VALID_SOURCE.replace(
      'seek() {}',
      'seek() { missingSeekIdentifier(); }',
    )

    await expect(probeFabricateRuntime(loadError)).resolves.toContainEqual({
      ruleId: 'runtime-page-script',
      message: '页面脚本执行失败',
    })
    await expect(probeFabricateRuntime(seekError)).resolves.toContainEqual({
      ruleId: 'runtime-seek-script',
      message: '逐帧 seek 脚本执行失败',
    })
  }, 20_000)

  it('bounds a never-settling seek and removes its temporary source', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'purpleink-probe-test-'))
    const source = VALID_SOURCE.replace(
      'seek() {}',
      'seek() { return new Promise(() => {}); }',
    )
    try {
      await expect(probeFabricateRuntime(source, {
        operationTimeoutMs: 1_000,
        totalTimeoutMs: 15_000,
        tempRoot,
      })).resolves.toContainEqual({
        ruleId: 'runtime-seek-timeout',
        message: '逐帧 seek 执行超时',
      })
      await expect(readdir(tempRoot)).resolves.toEqual([])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }, 20_000)

  it('honors cancellation and removes its temporary source', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'purpleink-probe-test-'))
    const controller = new AbortController()
    const source = VALID_SOURCE.replace(
      'seek() {}',
      'seek() { return new Promise(() => {}); }',
    )
    const reason = new Error('cancel probe')
    const timer = setTimeout(() => controller.abort(reason), 100)
    try {
      await expect(probeFabricateRuntime(source, {
        signal: controller.signal,
        operationTimeoutMs: 10_000,
        totalTimeoutMs: 20_000,
        tempRoot,
      })).rejects.toBe(reason)
      await expect(readdir(tempRoot)).resolves.toEqual([])
    } finally {
      clearTimeout(timer)
      await rm(tempRoot, { recursive: true, force: true })
    }
  }, 25_000)
})
