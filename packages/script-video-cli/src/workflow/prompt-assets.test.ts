import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseScriptValue } from '../input'
import {
  PROMPT_ASSET_NAMES,
  buildDirectPrompt,
  buildFabricatePrompt,
  buildHtmlRepairPrompt,
  buildSemanticIngestPrompt,
  buildShotSpecPrompt,
  buildTtsStylePrompt,
  hashPromptAssets,
  loadPromptAsset,
} from './prompts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('prompt assets', () => {
  it('loads every UTF-8 template without replacement characters', () => {
    expect(PROMPT_ASSET_NAMES).toEqual([
      'semantic-ingest',
      'global-constraints',
      'direct',
      'shot-spec',
      'fabricate',
      'asr-segment',
      'transcript-structure',
      'tts-style',
      'json-repair',
      'html-repair',
    ])
    for (const name of PROMPT_ASSET_NAMES) {
      const asset = loadPromptAsset(name)
      expect(asset.system.length).toBeGreaterThan(10)
      expect(asset.user.length).toBeGreaterThan(10)
      expect(`${asset.system}${asset.user}`).not.toContain('\uFFFD')
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u)
    }
    expect(hashPromptAssets(PROMPT_ASSET_NAMES)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('changes the template and bundle SHA when UTF-8 content changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-prompts-'))
    roots.push(root)
    await writeFile(join(root, 'direct.md'), '--- system ---\n系统\n--- user ---\n用户甲\n', 'utf8')
    const first = loadPromptAsset('direct', { rootDir: root })
    const firstBundle = hashPromptAssets(['direct'], { rootDir: root })

    await writeFile(join(root, 'direct.md'), '--- system ---\n系统\n--- user ---\n用户乙\n', 'utf8')
    const second = loadPromptAsset('direct', { rootDir: root })

    expect(second.sha256).not.toBe(first.sha256)
    expect(hashPromptAssets(['direct'], { rootDir: root })).not.toBe(firstBundle)
  })

  it('keeps existing DIRECT and SHOT-SPEC builders and adds the FABRICATE builder', () => {
    const input = parseScriptValue({
      schemaVersion: 1,
      title: '中文标题',
      language: 'zh-CN',
      durationSec: 12,
      visualStyle: '技术编辑风格',
      globalPrompt: 'GLOBAL_STYLE_SENTINEL：全片必须使用浅色立体视觉。',
      narration: 'off',
      units: [{ id: 'U001', text: '唯一来源事实。', visualIntent: 'show' }],
    })
    const director = { masterPlan: '一镜一判断', styleBible: '黑白视觉' }
    const shot = {
      id: 'S001',
      sourceUnitId: 'U001',
      purpose: '呈现事实',
      visualIntent: 'show',
      composition: 'diagram' as const,
      visualDescription: '中心关系图',
      facts: ['唯一来源事实。'],
      onScreenText: ['事实'],
      durationSec: 8,
    }

    expect(buildDirectPrompt(input).user).toContain('中文标题')
    expect(buildDirectPrompt(input).user).toContain('GLOBAL_STYLE_SENTINEL')
    expect(buildDirectPrompt(input).user).toContain('一个 source unit 必须对应一个镜头和一个核心判断')
    expect(buildDirectPrompt(input).user).toContain('相邻镜头必须改变拓扑、视角、运动方式或信息职责')
    expect(buildSemanticIngestPrompt('第一句。第二句。').user).toContain('禁止按字数、标点数或固定时长硬切')
    expect(buildShotSpecPrompt(input, director, input.units[0]!, 'S001').user).toContain('S001')
    expect(buildShotSpecPrompt(input, director, input.units[0]!, 'S001').user).toContain('0%、25%、60%、95%')
    expect(buildShotSpecPrompt(input, director, input.units[0]!, 'S001').user).toContain('GLOBAL_STYLE_SENTINEL')
    expect(buildFabricatePrompt(input, input.units[0]!, shot).user).toContain('data-pi-seed')
    expect(buildFabricatePrompt(input, input.units[0]!, shot).user).toContain('GLOBAL_STYLE_SENTINEL')
    expect(buildHtmlRepairPrompt(shot, 'gate failed', input.globalPrompt).user).toContain('GLOBAL_STYLE_SENTINEL')
    expect(buildSemanticIngestPrompt('第一句。第二句。').user).not.toContain('GLOBAL_STYLE_SENTINEL')
    expect(buildTtsStylePrompt(input, shot)).not.toContain('GLOBAL_STYLE_SENTINEL')
  })
})
