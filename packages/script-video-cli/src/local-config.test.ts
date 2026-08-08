import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { SecretProtector } from './dpapi'
import { LocalConfigStore, resolveLocalConfigPaths, type LocalConfigIo } from './local-config'

const roots: string[] = []
const fixedNow = new Date('2026-08-09T12:34:56.000Z')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LocalConfigStore save transaction', () => {
  it('validates the complete next config before protecting or writing a secret', async () => {
    const fixture = await createFixture()

    await expect(
      fixture.store.saveTextProfile({ baseUrl: 'not-a-valid-url', model: 'model', apiKey: 'synthetic-token' }),
    ).rejects.toBeDefined()

    expect(fixture.protector.protectCalls).toBe(0)
    expect(await fixture.io.list(fixture.paths.secretsDir)).toEqual([])
    expect(await fixture.io.exists(fixture.paths.configPath)).toBe(false)
  })

  it('keeps the previous config and secret when the config rename fails', async () => {
    const fixture = await createFixture()
    await fixture.store.saveTextProfile(validProfile('first'))
    const beforeConfig = await fixture.io.read(fixture.paths.configPath)
    const beforeSecrets = await fixture.io.list(fixture.paths.secretsDir)
    fixture.io.renameFailureTarget = fixture.paths.configPath

    await expect(fixture.store.saveTextProfile(validProfile('second'))).rejects.toMatchObject({
      code: 'CONFIG_WRITE_FAILED',
    })

    expect(await fixture.io.read(fixture.paths.configPath)).toEqual(beforeConfig)
    expect(await fixture.io.list(fixture.paths.secretsDir)).toEqual(beforeSecrets)
  })

  it('keeps the previous speech profile and secret when the config rename fails', async () => {
    const fixture = await createFixture()
    await fixture.store.saveSpeechProfile(validSpeechProfile('first'))
    const beforeConfig = await fixture.io.read(fixture.paths.configPath)
    const beforeSecrets = await fixture.io.list(fixture.paths.secretsDir)
    fixture.io.renameFailureTarget = fixture.paths.configPath

    await expect(fixture.store.saveSpeechProfile(validSpeechProfile('second'))).rejects.toMatchObject({
      code: 'CONFIG_WRITE_FAILED',
    })

    expect(await fixture.io.read(fixture.paths.configPath)).toEqual(beforeConfig)
    expect(await fixture.io.list(fixture.paths.secretsDir)).toEqual(beforeSecrets)
  })

  it('reports a failed old-secret cleanup without losing the new profile', async () => {
    const fixture = await createFixture()
    await fixture.store.saveTextProfile(validProfile('first'))
    const oldSecret = (await fixture.io.list(fixture.paths.secretsDir))[0]!
    fixture.io.removeFailures.add(join(fixture.paths.secretsDir, oldSecret))

    const result = await fixture.store.saveTextProfile(validProfile('second'))

    expect(result).toMatchObject({ secretCleanup: { status: 'pending', pendingCount: 1 } })
    expect(await fixture.io.list(fixture.paths.secretsDir)).toHaveLength(2)
    expect(JSON.parse(Buffer.from(await fixture.io.read(fixture.paths.configPath)).toString('utf8'))).toMatchObject({
      text: { model: 'model-second' },
    })
  })

  it('reclaims all unreferenced secrets during a later successful save', async () => {
    const fixture = await createFixture()
    await fixture.store.saveTextProfile(validProfile('first'))
    const firstSecret = (await fixture.io.list(fixture.paths.secretsDir))[0]!
    fixture.io.removeFailures.add(join(fixture.paths.secretsDir, firstSecret))
    await fixture.store.saveTextProfile(validProfile('second'))
    fixture.io.removeFailures.clear()

    const result = await fixture.store.saveTextProfile(validProfile('third'))

    expect(result).toMatchObject({ secretCleanup: { status: 'clean', pendingCount: 0 } })
    const remaining = await fixture.io.list(fixture.paths.secretsDir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatch(/^text-.*\.dpapi$/u)
  })
})

function validProfile(suffix: string): { baseUrl: string; model: string; apiKey: string } {
  return {
    baseUrl: `https://api.example.test/${suffix}/`,
    model: `model-${suffix}`,
    apiKey: `synthetic-token-${suffix}`,
  }
}

function validSpeechProfile(suffix: string): {
  baseUrl: string
  ttsModel: string
  asrModel: string
  apiKey: string
} {
  return {
    baseUrl: `https://speech.example.test/${suffix}/`,
    ttsModel: 'mimo-v2.5-tts',
    asrModel: 'mimo-v2.5-asr',
    apiKey: `synthetic-speech-token-${suffix}`,
  }
}

async function createFixture(): Promise<{
  paths: ReturnType<typeof resolveLocalConfigPaths>
  io: FaultIo
  protector: TrackingProtector
  store: LocalConfigStore
}> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-config-transaction-'))
  roots.push(root)
  const paths = resolveLocalConfigPaths({ LOCALAPPDATA: root }, root)
  const io = new FaultIo()
  const protector = new TrackingProtector()
  const store = new LocalConfigStore(paths, protector, { io, now: () => fixedNow })
  return { paths, io, protector, store }
}

class TrackingProtector implements SecretProtector {
  protectCalls = 0

  async protect(value: string): Promise<Uint8Array> {
    this.protectCalls += 1
    return Buffer.from(value, 'utf8').reverse()
  }

  async unprotect(value: Uint8Array): Promise<string> {
    return Buffer.from(value).reverse().toString('utf8')
  }
}

class FaultIo implements LocalConfigIo {
  renameFailureTarget: string | undefined
  readonly removeFailures = new Set<string>()

  read(path: string): Promise<Uint8Array> {
    return readFile(path)
  }

  async write(path: string, value: Uint8Array): Promise<void> {
    await writeFile(path, value)
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  async rename(from: string, to: string): Promise<void> {
    if (to === this.renameFailureTarget) throw new Error('synthetic rename failure')
    await rename(from, to)
  }

  async remove(path: string): Promise<void> {
    if (this.removeFailures.has(path)) throw new Error('synthetic remove failure')
    await rm(path, { force: true })
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  async list(directory: string): Promise<string[]> {
    try {
      return (await readdir(directory)).map((path) => basename(path)).sort()
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return []
      throw error
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
