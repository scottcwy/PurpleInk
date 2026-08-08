import { describe, expect, it } from 'vitest'

import { parseCliArgs } from './cli'

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
})
