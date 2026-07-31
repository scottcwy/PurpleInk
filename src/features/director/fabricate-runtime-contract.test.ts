import { describe, expect, it, vi } from 'vitest'
import { inspectFabricateRuntime } from './fabricate-runtime-contract'

vi.mock('server-only', () => ({}))

function html(script: string): string {
  return `<!doctype html><html><body><script>${script}</script></body></html>`
}

describe('inspectFabricateRuntime', () => {
  it('accepts syntactically valid inline JavaScript with the v1 runtime', () => {
    expect(inspectFabricateRuntime(html(`
      const timeline = { seek() {} };
      window.__CVC_RENDER__ = {
        version: 1,
        seek(frame, fps) { timeline.seek(frame / fps); },
      };
    `))).toEqual({ ok: true, errors: [] })
  })

  it('rejects a syntax error even when the runtime marker exists later in the script', () => {
    const result = inspectFabricateRuntime(html(`
      const broken = { timeline() { return {}; }, ease: true }:;
      window.__CVC_RENDER__ = { version: 1, seek() {} };
    `))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('脚本语法无效')
  })

  it('rejects source that never installs window.__CVC_RENDER__ v1', () => {
    const result = inspectFabricateRuntime(html('const timeline = { seek() {} };'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('window.__CVC_RENDER__')
    }
  })
})
