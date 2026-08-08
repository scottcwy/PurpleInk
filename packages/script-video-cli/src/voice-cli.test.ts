import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from './cli'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('voice CLI', () => {
  it('imports, uses, and lists voices with the common JSON envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-voice-cli-'))
    roots.push(root)
    const sample = join(root, 'voice.wav')
    const wav = Buffer.alloc(46)
    wav.write('RIFF', 0, 'ascii')
    wav.write('WAVE', 8, 'ascii')
    await writeFile(sample, wav)

    const imported = await invoke(root, ['voice', 'import', sample, '--name', 'my-voice', '--json'])
    const used = await invoke(root, ['voice', 'use', 'my-voice', '--json'])
    const listed = await invoke(root, ['voice', 'list', '--json'])

    expect(imported.payload).toMatchObject({ ok: true, command: 'voice.import', data: { voice: { id: 'my-voice' } } })
    expect(used.payload).toMatchObject({ ok: true, command: 'voice.use', data: { activeVoice: 'my-voice' } })
    expect(listed.payload).toMatchObject({
      ok: true,
      command: 'voice.list',
      data: { activeVoice: 'my-voice', voices: [{ id: 'my-voice' }] },
    })
    expect(listed.raw).not.toContain('base64')
  })
})

async function invoke(root: string, argv: string[]) {
  const lines: string[] = []
  const code = await runCli(
    argv,
    { LOCALAPPDATA: root },
    { writeLine: (line) => lines.push(line) },
    { localAppData: root },
  )
  const raw = lines.join('\n')
  return { code, raw, payload: JSON.parse(raw) as unknown }
}
