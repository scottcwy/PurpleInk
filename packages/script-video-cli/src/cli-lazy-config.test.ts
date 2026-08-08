import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from './cli'
import { readEffectiveCliConfig } from './config'
import type { SecretProtector } from './dpapi'
import { LocalConfigStore, resolveLocalConfigPaths } from './local-config'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('lazy local secret loading', () => {
  it('does not parse a corrupt local config for help', async () => {
    const root = await corruptedRoot()
    const lines: string[] = []

    const code = await runCli(
      ['help', '--json'],
      { LOCALAPPDATA: root },
      { writeLine: (line) => lines.push(line) },
      { localAppData: root },
    )

    expect(code).toBe(0)
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, command: 'help' })
  })

  it('does not parse a corrupt local config for a fixture plan', async () => {
    const root = await corruptedRoot()
    const scriptPath = join(root, 'script.md')
    await writeFile(scriptPath, '# Fixture\n\n## One\nFixture-only plan.', 'utf8')
    const lines: string[] = []

    const code = await runCli(
      ['plan', scriptPath, '--provider', 'fixture', '--output', join(root, 'runs'), '--json'],
      { LOCALAPPDATA: root },
      { writeLine: (line) => lines.push(line) },
      { localAppData: root },
    )

    expect(code).toBe(0)
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, command: 'plan' })
  })

  it('does not parse a corrupt local config when the environment has a complete text profile', async () => {
    const root = await corruptedRoot()
    const store = new LocalConfigStore(resolveLocalConfigPaths({ LOCALAPPDATA: root }, root), throwingProtector())

    const config = await readEffectiveCliConfig(
      {
        LOCALAPPDATA: root,
        SCRIPT_VIDEO_AI_BASE_URL: 'https://api.example.test/v1',
        SCRIPT_VIDEO_AI_API_KEY: 'synthetic-environment-token',
        SCRIPT_VIDEO_AI_MODEL: 'environment-model',
      },
      process.cwd(),
      store,
      { loadTextSecret: true },
    )

    expect(config.ai).toMatchObject({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'synthetic-environment-token',
      textModel: 'environment-model',
    })
  })

  it.each([
    ['help', ['help', '--json'], 0, undefined],
    ['status', ['status', '--json'], 1, 'RUN_NOT_FOUND'],
    ['doctor', ['doctor', '--json'], 0, undefined],
  ] as const)('does not decrypt the local text secret for %s', async (_name, argv, expectedExit, errorCode) => {
    const root = await configuredRoot()
    const protector = throwingProtector()
    const lines: string[] = []

    const code = await runCli(
      argv,
      { LOCALAPPDATA: root },
      { writeLine: (line) => lines.push(line) },
      { localAppData: root, secretProtector: protector },
    )

    expect(code).toBe(expectedExit)
    expect(protector.unprotectCalls).toBe(0)
    if (errorCode) expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: errorCode } })
  })

  it('applies --provider fixture before resolving the effective AI config', async () => {
    const root = await configuredRoot()
    const protector = throwingProtector()
    const scriptPath = join(root, 'script.md')
    await writeFile(scriptPath, '# Fixture\n\n## One\n只使用 fixture。', 'utf8')
    const lines: string[] = []

    const code = await runCli(
      ['plan', scriptPath, '--provider', 'fixture', '--output', join(root, 'runs'), '--json'],
      { LOCALAPPDATA: root },
      { writeLine: (line) => lines.push(line) },
      { localAppData: root, secretProtector: protector },
    )

    expect(code).toBe(0)
    expect(protector.unprotectCalls).toBe(0)
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, command: 'plan' })
  })
})

async function configuredRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-lazy-config-'))
  roots.push(root)
  const purpleInk = join(root, 'PurpleInk')
  const secrets = join(purpleInk, 'secrets')
  await mkdir(secrets, { recursive: true })
  await writeFile(join(secrets, 'text-existing.dpapi'), Buffer.from('sealed'))
  await writeFile(
    join(purpleInk, 'config.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-08-09T12:34:56.000Z',
      text: {
        baseUrl: 'https://api.example.test/v1',
        model: 'text-model',
        secretRef: 'text-existing.dpapi',
      },
      concurrency: { run: 2, text: 6, browser: 3, tts: 3, asr: 2, render: 1 },
    })}\n`,
    'utf8',
  )
  return root
}

async function corruptedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-corrupt-config-'))
  roots.push(root)
  const purpleInk = join(root, 'PurpleInk')
  await mkdir(purpleInk, { recursive: true })
  await writeFile(join(purpleInk, 'config.json'), '{not valid JSON', 'utf8')
  return root
}

function throwingProtector(): SecretProtector & { unprotectCalls: number } {
  return {
    unprotectCalls: 0,
    protect: async () => Buffer.from('unused'),
    async unprotect() {
      this.unprotectCalls += 1
      throw new Error('private decrypt detail')
    },
  }
}
