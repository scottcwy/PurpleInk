import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCliArgs } from '../args'
import { readCliConfig } from '../config'
import { prepareRun } from './run-support'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('global Prompt persistence', () => {
  it('loads one UTF-8 Prompt and restores it when a run resumes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-global-prompt-'))
    roots.push(root)
    const sourcePath = join(root, 'script.md')
    const promptPath = join(root, 'style.md')
    const stateDir = join(root, 'runs')
    await writeFile(sourcePath, '# 标题\n\n全局约束测试。\n', 'utf8')
    await writeFile(promptPath, '全片必须使用浅色立体视觉。\n', 'utf8')
    const config = readCliConfig(
      { SCRIPT_VIDEO_PROVIDER: 'fixture', SCRIPT_VIDEO_STATE_DIR: stateDir, INIT_CWD: root },
      root,
    )

    const first = await prepareRun(
      parseCliArgs(['run', sourcePath, '--global-prompt-file', promptPath, '--output', stateDir]),
      config,
    )
    expect(first.globalPrompt).toBe('全片必须使用浅色立体视觉。')
    expect(await readFile(join(first.run.runDir, 'input', 'global-prompt.txt'), 'utf8')).toBe(
      '全片必须使用浅色立体视觉。\n',
    )

    const resumed = await prepareRun(
      parseCliArgs(['run', first.sourcePath, '--resume', first.run.runDir, '--output', stateDir]),
      config,
    )
    expect(resumed.globalPrompt).toBe('全片必须使用浅色立体视觉。')
  })

  it('persists the sound-effects mode across queue and retry style resumes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-sfx-mode-'))
    roots.push(root)
    const sourcePath = join(root, 'script.md')
    const stateDir = join(root, 'runs')
    await writeFile(sourcePath, '# 标题\n\n音效模式测试。\n', 'utf8')
    const config = readCliConfig(
      { SCRIPT_VIDEO_PROVIDER: 'fixture', SCRIPT_VIDEO_STATE_DIR: stateDir, INIT_CWD: root },
      root,
    )

    const first = await prepareRun(parseCliArgs(['run', sourcePath, '--sfx', 'off', '--output', stateDir]), config)
    expect(first.soundEffectsMode).toBe('off')
    expect(await readFile(join(first.run.runDir, 'input', 'sfx-mode.txt'), 'utf8')).toBe('off\n')

    const resumed = await prepareRun(
      parseCliArgs(['run', first.sourcePath, '--resume', first.run.runDir, '--output', stateDir]),
      config,
    )
    expect(resumed.soundEffectsMode).toBe('off')
  })
})
