import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { renderHyperframesProject, type CommandRunner } from './hyperframes'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('renderHyperframesProject', () => {
  it('runs check before render with argv-safe local paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-render-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), '<html></html>', 'utf8')
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd })
      if (args[0] === 'render') await mkdir(join(root, 'renders'), { recursive: true })
      if (args[0] === 'render') await writeFile(join(root, 'renders', 'output.mp4'), Buffer.from('fake-video'))
      return { code: 0, stdout: 'ok', stderr: '' }
    }

    const result = await renderHyperframesProject(root, { runner, cliPath: 'hyperframes' })

    expect(calls).toEqual([
      { command: 'hyperframes', args: ['check'], cwd: root },
      { command: 'hyperframes', args: ['render', '--quality', 'standard'], cwd: root },
    ])
    expect(result.checkPassed).toBe(true)
    expect(result.videoPath).toBe(join(root, 'renders', 'output.mp4'))
  })

  it('keeps a failed check as advisory and still attempts best-effort render', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-render-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), '<html></html>', 'utf8')
    const calls: string[][] = []
    const runner: CommandRunner = async (command, args) => {
      calls.push([command, ...args])
      if (args[0] === 'check') return { code: 1, stdout: '', stderr: 'composition warnings' }
      await mkdir(join(root, 'renders'), { recursive: true })
      await writeFile(join(root, 'renders', 'output.mp4'), Buffer.from('fake-video'))
      return { code: 0, stdout: 'rendered', stderr: '' }
    }

    const result = await renderHyperframesProject(root, { runner, cliPath: 'hyperframes' })

    expect(result.checkPassed).toBe(false)
    expect(calls).toEqual([
      ['hyperframes', 'check'],
      ['hyperframes', 'render', '--quality', 'standard'],
    ])
  })
})
