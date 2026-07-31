import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTION_INTENTS, MOTION_INTENT_COUNT, countMotionIntents } from './motion-intents'
import { SPECIMENS } from './intent-specimens'

const SPEC = readFileSync('docs/conventions/motion-interaction.md', 'utf8')

describe('动效意图登记表', () => {
  it('每条意图都有标本，且没有孤儿标本', () => {
    const intentIds = MOTION_INTENTS.map(({ id }) => id).sort()
    expect(Object.keys(SPECIMENS).sort()).toEqual(intentIds)
  })

  it('意图编号与规范 §3 的行号一一对应且连续', () => {
    expect(MOTION_INTENTS.map(({ no }) => no)).toEqual(
      Array.from({ length: MOTION_INTENT_COUNT }, (_, index) => index + 1),
    )
  })

  it('id 唯一', () => {
    expect(new Set(MOTION_INTENTS.map(({ id }) => id)).size).toBe(MOTION_INTENT_COUNT)
  })

  /**
   * 状态口径必须诚实：pending 必须写明生产现状，否则对照台会变成
   * 「看起来核对过了」的假象；unified 不得携带 current，否则口径自相矛盾。
   */
  it('待迁移必须写明生产现状，已统一不得携带现状说明', () => {
    for (const intent of MOTION_INTENTS) {
      if (intent.status === 'pending') {
        expect(intent.current, `${intent.id} 是 pending，必须填 current`).toBeTruthy()
      } else {
        expect(intent.current, `${intent.id} 是 unified，不应有 current`).toBeUndefined()
      }
    }
  })

  it('状态计数覆盖全部意图', () => {
    expect(countMotionIntents('unified') + countMotionIntents('pending')).toBe(
      MOTION_INTENT_COUNT,
    )
  })

  it('每条意图都填了目标参数', () => {
    for (const intent of MOTION_INTENTS) {
      expect(intent.params.trim().length, `${intent.id} 缺少 params`).toBeGreaterThan(0)
    }
  })
})

describe('动效意图与规范文档同步', () => {
  it('规范 §3 声明的意图条数与登记表一致', () => {
    // 规范 §3 表格每行以 "| 序号 |" 开头，统计行数即意图条数。
    const rows = SPEC.match(/^\| \d+ \| /gm) ?? []
    expect(rows).toHaveLength(MOTION_INTENT_COUNT)
  })

  it('规范列出的每条意图标题都能在登记表里找到', () => {
    const titles = new Set(MOTION_INTENTS.map(({ title }) => title))
    for (const row of SPEC.match(/^\| \d+ \| ([^|]+) \|/gm) ?? []) {
      const title = row.split('|')[2]?.trim() ?? ''
      expect(titles, `规范 §3 的「${title}」未登记`).toContain(title)
    }
  })
})

describe('标本的客户端边界', () => {
  /**
   * 对照台是交互式的。标本文件若漏了 'use client'，`next build` 会在 prerender
   * 阶段直接失败（报 "Event handlers cannot be passed to Client Component props"）。
   * 同 registry.test.ts 的既有教训。
   */
  it('所有标本实现与舞台原语都声明了客户端边界', () => {
    for (const file of [
      'src/app/playbook/motion/specimen-stage.tsx',
      'src/app/playbook/motion/specimens-controls.tsx',
      'src/app/playbook/motion/specimens-overlays.tsx',
      'src/app/playbook/motion/specimens-layout.tsx',
      'src/app/playbook/motion/intent-bench.tsx',
      'src/app/playbook/foundations/motion-tokens-section.tsx',
    ]) {
      expect(readFileSync(file, 'utf8').startsWith("'use client'"), file).toBe(true)
    }
  })
})
