import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AiClient } from '../ai/openai-compatible'
import { parseScriptValue } from '../input'
import { FileStateStore } from '../state/file-store'
import { atomizeSemanticSource, semanticIngestMarkdown, semanticResultSchema } from './semantic-ingest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic ingest', () => {
  it('requires ordered, continuous and complete source coverage', () => {
    const source = '第一句说明问题。\n\n第二句继续解释。\n\n但是这里转向新结论。'
    const schema = semanticResultSchema(source)

    expect(
      schema.parse({
        units: [
          { id: 'U001', from: 'A001', to: 'A002', order: 0 },
          { id: 'U002', from: 'A003', to: 'A003', order: 1 },
        ],
      }).units,
    ).toHaveLength(2)
    expect(schema.safeParse({ units: [{ id: 'U001', from: 'A001', to: 'A001', order: 0 }] }).success).toBe(false)
    expect(
      schema.safeParse({
        units: [
          { id: 'U001', from: 'A001', to: 'A002', order: 0 },
          { id: 'U002', from: 'A002', to: 'A003', order: 1 },
        ],
      }).success,
    ).toBe(false)
  })

  it('keeps emoji and Chinese source text intact while creating addressable atoms', () => {
    const source = '给大家同步一下后续安排🥰：\n我们的课程分享人招募在明天确定下来。\n以上，大家收到请回复！🥳'
    const atoms = atomizeSemanticSource(source)

    expect(atoms.map((atom) => atom.id)).toEqual(['A001', 'A002', 'A003', 'A004', 'A005'])
    expect(atoms.map((atom) => atom.text).join('')).toContain('🥰')
    expect(atoms.map((atom) => atom.text).join('')).toContain('🥳')
    expect(atoms.some((atom) => atom.text.includes('\uFFFD'))).toBe(false)
  })

  it('repairs one invalid split and persists the normalized semantic script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-semantic-ingest-'))
    roots.push(root)
    const store = new FileStateStore(root)
    const run = await store.createRun({ inputHash: 'a'.repeat(64), title: '语义拆稿', workflowVersion: 'test-v2' })
    const source = '第一句说明问题。\n\n第二句继续解释。\n\n但是这里转向新结论。'
    let calls = 0
    const ai: AiClient = {
      completeJson: async () => {
        calls += 1
        return calls === 1
          ? { units: [{ id: 'U001', from: 'A001', to: 'A001', order: 0 }] }
          : {
              units: [
                { id: 'U001', from: 'A001', to: 'A002', order: 0 },
                { id: 'U002', from: 'A003', to: 'A003', order: 1 },
              ],
            }
      },
      completeText: async () => '',
    }
    const base = parseScriptValue({
      schemaVersion: 1,
      title: '语义拆稿',
      language: 'zh-CN',
      durationSec: 30,
      visualStyle: 'editorial technical',
      narration: 'auto',
      units: [{ id: 'U001', text: source, visualIntent: 'show' }],
    })

    const result = await semanticIngestMarkdown(base, source, ai, { store, runDir: run.runDir })

    expect(calls).toBe(2)
    expect(result.units.map((unit) => unit.text)).toEqual([
      '第一句说明问题。\n\n第二句继续解释。',
      '但是这里转向新结论。',
    ])
    expect(await store.readStage(run.runDir, 'INGEST_SEMANTIC')).toMatchObject({
      status: 'succeeded',
      artifactIds: ['semantic-script'],
    })
  })
})
