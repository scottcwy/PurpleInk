import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AiClient } from '../ai/openai-compatible'
import type { ScriptVideoInput, ShotPlan } from '../contracts'
import { generateShots } from './codegen'
import { validateShotHtml } from './gates'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const input: ScriptVideoInput = {
  schemaVersion: 1,
  title: 'Demo',
  language: 'zh-CN',
  durationSec: 30,
  visualStyle: 'technical',
  narration: 'off',
  units: [
    { id: 'U001', text: '事实一。', visualIntent: 'show' },
    { id: 'U002', text: '事实二。', visualIntent: 'show' },
    { id: 'U003', text: '事实三。', visualIntent: 'show' },
    { id: 'U004', text: '事实四。', visualIntent: 'show' },
  ],
}

const plans: ShotPlan[] = input.units.map((unit, index) => ({
  id: `S${String(index + 1).padStart(3, '0')}`,
  sourceUnitId: unit.id,
  purpose: '表达来源事实。',
  visualIntent: 'show',
  composition: 'split',
  visualDescription: '左侧事实，右侧关系。',
  facts: [unit.text],
  onScreenText: ['事实'],
  durationSec: 7,
}))

const validHtml = `<!doctype html>
<html><body><main data-pi-seed="fixture">事实</main><script>
window.__PURPLEINK_RENDER__ = { ready: true, durationSec: 7, seek: function () {} };
</script></body></html>`

describe('validateShotHtml', () => {
  it('accepts a local deterministic render document', () => {
    expect(validateShotHtml(validHtml)).toMatchObject({ passed: true })
  })

  it('rejects network resources and credential-like content', () => {
    const result = validateShotHtml(
      '<html><body><script src="https://evil.example/x.js"></script>' +
        '<script>const apiKey = "secret"</script></body></html>',
    )
    expect(result.passed).toBe(false)
    expect(result.errors.join(' ')).toMatch(/network|credential|metadata/i)
  })
})

describe('generateShots', () => {
  it('generates shots within the configured concurrency and writes each attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-codegen-'))
    roots.push(root)
    let active = 0
    let maximum = 0
    const ai: AiClient = {
      completeText: async ({ user }) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        expect(user).toContain('不得新增')
        return validHtml
      },
      completeJson: async () => ({}),
    }

    const result = await generateShots(input, plans, {
      ai,
      outputDir: root,
      concurrency: 2,
    })

    expect(maximum).toBe(2)
    expect(result.failed).toHaveLength(0)
    expect(result.succeeded).toHaveLength(4)
    expect(result.succeeded.every((shot) => shot.screenshotHashes?.length === 0)).toBe(true)
    await access(join(root, 'shots', 'S001', 'attempt-001', 'source.html'))
    expect(await readFile(join(root, 'shots', 'S001', 'attempt-001', 'source.html'), 'utf8')).toContain(
      'PURPLEINK_RENDER',
    )
  })

  it('records a failed shot without marking it succeeded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-codegen-'))
    roots.push(root)
    const ai: AiClient = {
      completeText: async ({ user }) => (user.includes('S002') ? '<html>bad https://remote</html>' : validHtml),
      completeJson: async () => ({}),
    }

    const result = await generateShots(input, plans.slice(0, 2), {
      ai,
      outputDir: root,
      concurrency: 2,
      runtimeGate: async () => ({ passed: true, errors: [], screenshotHashes: [] }),
    })

    expect(result.succeeded.map((shot) => shot.id)).toEqual(['S001'])
    expect(result.failed.map((shot) => shot.id)).toEqual(['S002'])
    expect(result.failed[0]?.errorCode).toBe('SHOT_OUTPUT_INVALID')
    expect(await readFile(join(root, 'shots', 'S002', 'attempt-002', 'source.html'), 'utf8')).toContain(
      '<html>bad https://remote</html>',
    )
  })

  it('uses one HTML repair request after a gate failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-codegen-repair-'))
    roots.push(root)
    let calls = 0
    const ai: AiClient = {
      completeText: async () => {
        calls += 1
        return calls === 1 ? '<html><body data-pi-seed="x">bad<script>eval("x")</script></body></html>' : validHtml
      },
      completeJson: async () => ({}),
    }
    const result = await generateShots(input, plans.slice(0, 1), {
      ai,
      outputDir: root,
      concurrency: 1,
      runtimeGate: async () => ({ passed: true, errors: [], screenshotHashes: [] }),
    })
    expect(calls).toBe(2)
    expect(result.failed).toHaveLength(0)
    expect(result.succeeded[0]?.attempt).toBe(2)
    await access(join(root, 'shots', 'S001', 'attempt-002', 'source.html'))
  })

  it('extracts a complete HTML document from unfenced explanatory text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-codegen-unfenced-'))
    roots.push(root)
    const ai: AiClient = {
      completeText: async () => `下面是结果：\n${validHtml}\n以上是完整镜头。`,
      completeJson: async () => ({}),
    }

    const result = await generateShots(input, plans.slice(0, 1), {
      ai,
      outputDir: root,
      concurrency: 1,
      runtimeGate: async () => ({ passed: true, errors: [], screenshotHashes: [] }),
    })
    const saved = await readFile(join(root, 'shots', 'S001', 'attempt-001', 'source.html'), 'utf8')

    expect(result.failed).toHaveLength(0)
    expect(saved.startsWith('<!doctype html>')).toBe(true)
    expect(saved.trimEnd().endsWith('</html>')).toBe(true)
    expect(saved).not.toContain('下面是结果')
    expect(saved).not.toContain('以上是完整镜头')
  })

  it('normalizes local runtime dependencies without inventing a proxy render contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-codegen-adapter-'))
    roots.push(root)
    const ai: AiClient = {
      completeText: async () => `下面是完整镜头：
        \`\`\`html
        <!doctype html><html><head><style>body { font-family: "Microsoft YaHei", sans-serif; }</style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js"></script></head>
        <body data-pi-seed="x"><main>事实</main><script>
        function renderFrame(time) { document.body.dataset.time = String(time); }
        function loop() { requestAnimationFrame(loop); }
        window.__PURPLEINK_RENDER__ = { ready: true, durationSec: 7, seekTo: renderFrame };
        </script></body></html>
        \`\`\`
        已完成。`,
      completeJson: async () => ({}),
    }

    const result = await generateShots(input, plans.slice(0, 1), {
      ai,
      outputDir: root,
      concurrency: 1,
      runtimeGate: async () => ({ passed: true, errors: [], screenshotHashes: [] }),
    })
    const saved = await readFile(join(root, 'shots', 'S001', 'attempt-001', 'source.html'), 'utf8')

    expect(result.failed).toHaveLength(0)
    expect(saved).toContain('ready: true')
    expect(saved).not.toContain('durationSec: durationSec')
    expect(saved).not.toContain('value * durationSec')
    expect(saved).toContain('function loop() { requestAnimationFrame(loop); }')
    expect(saved).not.toContain('Microsoft YaHei')
    expect(saved).not.toContain('下面是完整镜头')
    expect(saved).not.toContain('已完成')
    expect(saved).toContain('data-purpleink-runtime="gsap"')
    expect(saved).not.toContain('cdnjs.cloudflare.com/ajax/libs/gsap')
    expect(saved).toContain('chart.umd.min.js')
    expect(saved).not.toContain('__purpleinkDisabledAnimationFrame')
  })
})
