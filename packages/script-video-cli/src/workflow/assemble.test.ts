import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ScriptVideoInput, ShotPlan } from '../contracts'
import type { CodegenResult } from './codegen'
import { assembleProject } from './assemble'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const input: ScriptVideoInput = {
  schemaVersion: 1,
  title: '本地脚本视频',
  language: 'zh-CN',
  durationSec: 14,
  visualStyle: 'technical',
  narration: 'off',
  units: [
    { id: 'U001', text: '第一条事实。', visualIntent: 'show' },
    { id: 'U002', text: '第二条事实。', visualIntent: 'show' },
  ],
}

const plans: ShotPlan[] = [
  {
    id: 'S001',
    sourceUnitId: 'U001',
    purpose: '开场',
    visualIntent: 'show',
    composition: 'full-bleed',
    visualDescription: '展示第一条事实',
    facts: ['第一条事实。'],
    onScreenText: ['第一条事实。'],
    durationSec: 7,
  },
  {
    id: 'S002',
    sourceUnitId: 'U002',
    purpose: '承接',
    visualIntent: 'show',
    composition: 'split',
    visualDescription: '展示第二条事实',
    facts: ['第二条事实。'],
    onScreenText: ['第二条事实。'],
    durationSec: 7,
  },
]

function codegenResult(): CodegenResult {
  return {
    failed: [],
    succeeded: plans.map((plan) => ({
      id: plan.id,
      sourceUnitId: plan.sourceUnitId,
      status: 'succeeded' as const,
      attempt: 1,
      relativeHtmlPath: `shots/${plan.id}/attempt-001/source.html`,
    })),
  }
}

async function createShots(root: string): Promise<void> {
  for (const plan of plans) {
    const path = join(root, 'shots', plan.id, 'attempt-001', 'source.html')
    await mkdir(join(root, 'shots', plan.id, 'attempt-001'), { recursive: true })
    await writeFile(path, `<!doctype html><html><body><main>${plan.id}</main></body></html>`, 'utf8')
  }
}

describe('assembleProject', () => {
  it('creates a self-contained HyperFrames project from gated local shots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-assemble-'))
    roots.push(root)
    await createShots(root)

    const result = await assembleProject(input, plans, codegenResult(), { outputDir: root, narration: { mode: 'off' } })
    const index = await readFile(result.indexPath, 'utf8')

    expect(result.durationSec).toBe(14)
    expect(result.narration).toMatchObject({ mode: 'off', status: 'off' })
    expect(index).toContain('data-composition-src="compositions/S001.html"')
    expect(index).toContain('data-composition-src="compositions/S002.html"')
    expect(index).toContain('data-composition-id="S001"')
    expect(index).toContain('data-track-index="1"')
    expect(index).not.toMatch(/https?:\/\//u)
    const shot = await readFile(join(result.projectDir, 'compositions', 'S001.html'), 'utf8')
    expect(shot).toContain('<template>')
    expect(shot).toContain('data-composition-id="S001"')
    expect(shot.indexOf('<style>')).toBeGreaterThan(shot.indexOf('<template>'))
    await access(join(result.projectDir, 'compositions', 'S001.html'))
    await access(result.manifestPath)
    await access(result.subtitlePath)
  })

  it('marks auto narration degraded when no user-owned TTS adapter is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-assemble-'))
    roots.push(root)
    await createShots(root)

    const result = await assembleProject(input, plans, codegenResult(), {
      outputDir: root,
      narration: { mode: 'auto' },
    })

    expect(result.narration).toMatchObject({ mode: 'auto', status: 'degraded' })
  })

  it('does not silently omit required narration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-assemble-'))
    roots.push(root)
    await createShots(root)

    await expect(
      assembleProject(input, plans, codegenResult(), { outputDir: root, narration: { mode: 'required' } }),
    ).rejects.toMatchObject({ code: 'TTS_CONFIG_INVALID' })
  })
})
