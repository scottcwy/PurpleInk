import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startObserver } from './observer'
import { registerFileArtifact } from './state/artifacts'
import { FileStateStore } from './state/file-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('observer', () => {
  it('serves registered artifacts and rejects unregistered paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-observer-'))
    roots.push(root)
    const store = new FileStateStore(root)
    const run = await store.createRun({
      runId: 'run-observer',
      inputHash: createHash('sha256').update('input').digest('hex'),
      title: '观察页测试',
      workflowVersion: 'test-v1',
    })
    const htmlPath = join(run.runDir, 'shots', 'S001', 'attempt-001', 'source.html')
    await mkdir(join(run.runDir, 'shots', 'S001', 'attempt-001'), { recursive: true })
    await writeFile(
      htmlPath,
      '<!doctype html><html><body>shot<script>window.__PURPLEINK_RENDER__={seek(value){window.preview=value}}</script></body></html>',
      'utf8',
    )
    await registerFileArtifact(store, run.runDir, { id: 'shot-S001-html', kind: 'text/html', path: htmlPath })
    const observer = await startObserver({ stateDir: root, port: 0 })
    try {
      const home = await fetch(observer.url)
      expect(await home.text()).toContain('观察页测试')
      expect((await fetch(`${observer.url}favicon.ico`)).status).toBe(204)
      const artifact = await fetch(`${observer.url}artifact/run-observer/shot-S001-html`)
      expect(artifact.status).toBe(200)
      expect(artifact.headers.get('content-security-policy')).toContain("connect-src 'none'")
      expect(await artifact.text()).toContain('shot')
      const preview = await fetch(`${observer.url}artifact/run-observer/shot-S001-html?preview=midpoint`)
      const previewSource = await preview.text()
      expect(previewSource).toContain('render.seek(0.5)')
      expect(previewSource).toContain('Math.min(innerWidth/1920,innerHeight/1080)')
      const missing = await fetch(`${observer.url}artifact/run-observer/not-registered`)
      expect(missing.status).toBe(404)
    } finally {
      await observer.close()
    }
  })
})
