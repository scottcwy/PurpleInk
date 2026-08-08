import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { VoiceStore, resolveVoiceStorePaths } from './voice-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('VoiceStore', () => {
  it('imports, hashes, activates, and lists a local sample without Base64 state', async () => {
    const root = await createRoot()
    const source = join(root, 'sample.wav')
    const bytes = syntheticWav(11)
    await writeFile(source, bytes)
    const store = new VoiceStore(resolveVoiceStorePaths({ LOCALAPPDATA: root }, root))

    const imported = await store.import(source, 'narrator-one')
    await store.use('narrator-one')
    const listed = await store.list()

    expect(imported).toMatchObject({
      id: 'narrator-one',
      mimeType: 'audio/wav',
      sizeBytes: bytes.byteLength,
    })
    expect(imported.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(listed.activeVoice).toBe('narrator-one')
    expect(listed.voices).toEqual([imported])
    expect(Buffer.from(await readFile(imported.path))).toEqual(bytes)
    expect(await readFile(join(root, 'PurpleInk', 'voices', 'index.json'), 'utf8')).not.toContain('base64')
  })

  it('allows an idempotent duplicate but rejects the same name with a different hash', async () => {
    const root = await createRoot()
    const first = join(root, 'first.mp3')
    const second = join(root, 'second.mp3')
    await writeFile(first, Buffer.from('ID3first-sample', 'ascii'))
    await writeFile(second, Buffer.from('ID3different-sample', 'ascii'))
    const store = new VoiceStore(resolveVoiceStorePaths({ LOCALAPPDATA: root }, root))

    const imported = await store.import(first, 'same-name')
    await expect(store.import(first, 'same-name')).resolves.toEqual(imported)
    await expect(store.import(second, 'same-name')).rejects.toMatchObject({ code: 'VOICE_NAME_CONFLICT' })
    expect((await store.list()).voices).toHaveLength(1)
  })

  it('supports mimo_default and rejects invalid names and unsupported formats', async () => {
    const root = await createRoot()
    const unsupported = join(root, 'sample.txt')
    await writeFile(unsupported, 'not audio', 'utf8')
    const store = new VoiceStore(resolveVoiceStorePaths({ LOCALAPPDATA: root }, root))

    await store.use('mimo_default')
    await expect(store.import(unsupported, 'valid-name')).rejects.toMatchObject({ code: 'VOICE_FORMAT_UNSUPPORTED' })
    await expect(store.import(unsupported, 'Invalid_Name')).rejects.toMatchObject({ code: 'VOICE_NAME_INVALID' })
    await expect(store.use('missing-name')).rejects.toMatchObject({ code: 'VOICE_NOT_FOUND' })
    expect((await store.list()).activeVoice).toBe('mimo_default')
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-voice-store-'))
  roots.push(root)
  return root
}

function syntheticWav(marker: number): Buffer {
  const bytes = Buffer.alloc(46)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('data', 36, 'ascii')
  bytes[45] = marker
  return bytes
}
