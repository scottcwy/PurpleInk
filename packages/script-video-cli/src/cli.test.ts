import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCliArgs, runCli } from './cli'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('parseCliArgs', () => {
  it('parses unattended run flags', () => {
    expect(parseCliArgs(['run', 'script.json', '--concurrency', '5', '--narration', 'auto', '--json'])).toEqual({
      command: 'run',
      inputPath: 'script.json',
      concurrency: 5,
      narration: 'auto',
      json: true,
      skipBrowserGate: false,
      provider: undefined,
      outputDir: undefined,
      resumeDir: undefined,
    })
  })

  it('accepts an explicit fixture provider and browser-gate opt out', () => {
    const args = parseCliArgs(['plan', '--input', 'script.md', '--provider', 'fixture', '--no-browser-gate'])

    expect(args).toMatchObject({
      command: 'plan',
      inputPath: 'script.md',
      provider: 'fixture',
      skipBrowserGate: true,
    })
  })

  it('parses secure text profile commands without accepting a key argument', () => {
    expect(
      parseCliArgs([
        'config',
        'set',
        'text',
        '--url',
        'https://api.example.test/v1',
        '--model',
        'text-model',
        '--key-stdin',
      ]),
    ).toMatchObject({
      command: 'config',
      configAction: 'set',
      configTarget: 'text',
      configUrl: 'https://api.example.test/v1',
      configModel: 'text-model',
      keyStdin: true,
    })

    expect(() =>
      parseCliArgs([
        'config',
        'set',
        'text',
        '--url',
        'https://api.example.test/v1',
        '--model',
        'text-model',
        '--api-key',
        'forbidden',
      ]),
    ).toThrow(/禁止|key-stdin/u)
  })
})

describe('runCli JSON envelope', () => {
  it('uses the common non-watch envelope for existing commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-cli-envelope-'))
    roots.push(root)
    const lines: string[] = []

    const code = await runCli(
      ['help', '--json'],
      { LOCALAPPDATA: root },
      { writeLine: (line) => lines.push(line) },
      { localAppData: root },
    )

    expect(code).toBe(0)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      ok: true,
      command: 'help',
      data: { command: 'help' },
    })
    expect(JSON.parse(lines[0]!)).not.toHaveProperty('result')
  })
})
