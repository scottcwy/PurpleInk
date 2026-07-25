import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkV3Architecture,
  createV3ArchitectureBaseline,
  scanV3Architecture,
  writeV3ArchitectureBaseline,
} from '../../../scripts/verify/v3-architecture'

const AGENTS_ROOT = ['@openai', 'agents'].join('/')
const AGENTS_CORE = `${AGENTS_ROOT}-core`
const AGENTS_RUNTIME = `${AGENTS_ROOT}/runtime`
const DIRECT_OPENAI = ['open', 'ai'].join('')

let fixtureRoot: string

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'cvc-v3-architecture-'))
})

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('OpenAI runtime boundaries', () => {
  it.each([AGENTS_ROOT, AGENTS_CORE])(
    '拒绝 package 依赖 %s',
    (specifier) => {
      writeFixture(
        'package.json',
        JSON.stringify({ dependencies: { [specifier]: '1.0.0' } })
      )

      const report = scanFixture()

      expect(report.agentsSdkPackages).toEqual([
        expect.objectContaining({
          ruleId: 'AGENTS_SDK_PACKAGE',
          path: 'package.json',
          specifier,
        }),
      ])
      expect(checkV3Architecture(report, emptyBaseline())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'AGENTS_SDK_PACKAGE' }),
        ])
      )
    }
  )

  it('拒绝通过 npm alias 引入 Agents SDK', () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        dependencies: { agentRuntime: `npm:${AGENTS_CORE}@1.0.0` },
      })
    )

    expect(scanFixture().agentsSdkPackages).toEqual([
      expect.objectContaining({
        ruleId: 'AGENTS_SDK_PACKAGE',
        path: 'package.json',
        specifier: AGENTS_CORE,
      }),
    ])
  })

  it.each([AGENTS_ROOT, AGENTS_CORE, AGENTS_RUNTIME])(
    '拒绝 source import %s',
    (specifier) => {
      writeFixture('src/agent.ts', `import '${specifier}'`)

      const report = scanFixture()

      expect(report.agentsSdkImports).toEqual([
        expect.objectContaining({
          ruleId: 'AGENTS_SDK_IMPORT',
          path: 'src/agent.ts',
          specifier,
          line: 1,
        }),
      ])
    }
  )

  it('不把普通 openai 或相似前缀误判为 Agents SDK', () => {
    writeFixture(
      'src/client.ts',
      [
        `import OpenAI from '${DIRECT_OPENAI}'`,
        `import '@openai/agentsx'`,
      ].join('\n')
    )

    const report = scanFixture()
    const baseline = createV3ArchitectureBaseline(report)

    expect(report.agentsSdkImports).toEqual([])
    expect(report.directOpenAiClientImports).toHaveLength(1)
    expect(checkV3Architecture(report, baseline)).toEqual([])

    writeFixture(
      'src/second-client.ts',
      `const client = require('${DIRECT_OPENAI}')`
    )
    expect(checkV3Architecture(scanFixture(), baseline)).toContainEqual(
      expect.objectContaining({
        ruleId: 'DEBT_CAP_EXCEEDED',
        category: 'directOpenAiClientImports',
        cap: 1,
        actual: 2,
      })
    )
  })
})

describe('dependency direction', () => {
  it('阻止 Canvas 新增 Trigger、Pi、Drizzle 或 HyperFrames 依赖', () => {
    const forbidden = [
      'drizzle-orm',
      '@trigger.dev/sdk',
      '@/trigger/dispatcher',
      '@/features/pipeline/trigger-adapter',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-ai',
      'hyperframes',
    ]
    writeFixture(
      'src/features/canvas/new-action.ts',
      forbidden.map((specifier) => `import '${specifier}'`).join('\n')
    )

    const report = scanFixture()

    expect(report.canvasForbiddenImports.map(({ specifier }) => specifier)).toEqual(
      forbidden
    )
    expect(checkV3Architecture(report, emptyBaseline())).toContainEqual(
      expect.objectContaining({
        ruleId: 'DEBT_CAP_EXCEEDED',
        category: 'canvasForbiddenImports',
        actual: forbidden.length,
      })
    )
  })

  it('阻止 Trigger task 直连 Drizzle/DB schema 且不误伤 payload schema', () => {
    const forbidden = [
      'drizzle-orm',
      'drizzle-orm/pg-core',
      '@/lib/db/schema',
      '../../src/lib/db/schema',
    ]
    const allowed = [
      '@trigger.dev/sdk',
      'zod',
      '@/features/pipeline/project-plan-service',
      './payload-schema',
    ]
    writeFixture(
      'trigger/tasks/project-plan.ts',
      [...forbidden, ...allowed]
        .map((specifier) => `import '${specifier}'`)
        .join('\n')
    )

    const report = scanFixture()

    expect(
      report.triggerTaskForbiddenImports.map(({ specifier }) => specifier)
    ).toEqual(forbidden)
    expect(checkV3Architecture(report, emptyBaseline())).toContainEqual(
      expect.objectContaining({
        ruleId: 'DEBT_CAP_EXCEEDED',
        category: 'triggerTaskForbiddenImports',
        actual: forbidden.length,
      })
    )
  })

  it('对受治理目录的非字面量模块加载 fail-closed', () => {
    writeFixture(
      'src/features/canvas/dynamic.ts',
      `const moduleName = '@/trigger/dispatcher'\nvoid import(moduleName)`
    )
    writeFixture(
      'trigger/tasks/dynamic.ts',
      `const moduleName = '@/lib/db/schema'\nrequire(moduleName)`
    )

    const report = scanFixture()

    expect(report.canvasForbiddenImports).toEqual([
      expect.objectContaining({ specifier: '<non-literal-module>' }),
    ])
    expect(report.triggerTaskForbiddenImports).toEqual([
      expect.objectContaining({ specifier: '<non-literal-module>' }),
    ])
  })
})

describe('file length debt', () => {
  it('按 page、一般生产文件、schema/repository 三档硬上限拒绝新超限文件', () => {
    writeLines('src/app/example/page.tsx', 301)
    writeLines('src/features/example/huge.ts', 351)
    writeLines('src/features/example/repository.ts', 401)

    const violations = checkV3Architecture(scanFixture(), emptyBaseline())

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'OVERSIZED_NEW_FILE',
          path: 'src/app/example/page.tsx',
          actualLines: 301,
          hardLimit: 300,
        }),
        expect.objectContaining({
          ruleId: 'OVERSIZED_NEW_FILE',
          path: 'src/features/example/huge.ts',
          actualLines: 351,
          hardLimit: 350,
        }),
        expect.objectContaining({
          ruleId: 'OVERSIZED_NEW_FILE',
          path: 'src/features/example/repository.ts',
          actualLines: 401,
          hardLimit: 400,
        }),
      ])
    )
  })

  it('只允许历史超限文件持平、下降或删除', () => {
    writeLines('src/features/legacy.ts', 351)
    const baseline = createV3ArchitectureBaseline(scanFixture())

    expect(checkV3Architecture(scanFixture(), baseline)).toEqual([])

    writeLines('src/features/legacy.ts', 352)
    expect(checkV3Architecture(scanFixture(), baseline)).toContainEqual({
      ruleId: 'OVERSIZED_FILE_GROWTH',
      path: 'src/features/legacy.ts',
      baselineLines: 351,
      actualLines: 352,
      hardLimit: 350,
    })

    writeLines('src/features/legacy.ts', 350)
    expect(checkV3Architecture(scanFixture(), baseline)).toEqual([])

    rmSync(join(fixtureRoot, 'src/features/legacy.ts'))
    expect(checkV3Architecture(scanFixture(), baseline)).toEqual([])
  })
})

describe('UTF-8 and scan exclusions', () => {
  it('报告 Markdown、TS、TSX 中的 U+FFFD', () => {
    const replacement = String.fromCharCode(0xfffd)
    writeFixture('docs/bad.md', `第一行\n${replacement}`)
    writeFixture('src/bad.ts', `export const bad = '${replacement}'`)
    writeFixture('src/bad.tsx', `export const bad = <span>${replacement}</span>`)

    const report = scanFixture()

    expect(report.replacementCharacters).toHaveLength(3)
    expect(report.replacementCharacters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'UTF8_REPLACEMENT_CHARACTER',
          path: 'docs/bad.md',
          line: 2,
        }),
      ])
    )
  })

  it('在读取前排除 .pen、生成目录、依赖与用户工具目录', () => {
    const replacement = String.fromCharCode(0xfffd)
    const excluded = [
      'docs/designs/canvas.pen',
      '.data/bad.ts',
      '.next/bad.ts',
      'node_modules/pkg/bad.ts',
      '.qoder/repowiki/bad.md',
    ]
    excluded.forEach((path) => writeFixture(path, replacement))
    const reads: string[] = []

    const report = scanV3Architecture({
      rootDir: fixtureRoot,
      readTextFile(path) {
        reads.push(toPosix(relative(fixtureRoot, path)))
        return readFileSync(path, 'utf8')
      },
    })

    expect(reads).toEqual([])
    expect(report.scannedFiles).toBe(0)
    expect(report.replacementCharacters).toEqual([])
  })
})

describe('baseline persistence', () => {
  it('原子写入一次并拒绝覆盖已存在 baseline', () => {
    const baseline = emptyBaseline()
    const path = join(fixtureRoot, 'baseline.json')

    writeV3ArchitectureBaseline(path, baseline)

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(baseline)
    expect(() => writeV3ArchitectureBaseline(path, baseline)).toThrow(
      /baseline 已存在/
    )
    expect(readdirSync(fixtureRoot)).toEqual(['baseline.json'])
  })
})

function scanFixture() {
  return scanV3Architecture({ rootDir: fixtureRoot })
}

function emptyBaseline() {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'cvc-v3-architecture-empty-'))
  try {
    return createV3ArchitectureBaseline(
      scanV3Architecture({ rootDir: emptyRoot })
    )
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true })
  }
}

function writeFixture(path: string, content: string): void {
  const absolutePath = join(fixtureRoot, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
}

function writeLines(path: string, count: number): void {
  writeFixture(path, Array(count).fill('export {}').join('\n'))
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}
