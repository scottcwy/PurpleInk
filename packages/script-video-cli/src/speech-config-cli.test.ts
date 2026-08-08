import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { MimoSpeechClient, MimoSpeechConfig } from './speech/mimo-client'
import { runCli, type CliRuntimeOptions } from './cli'
import { verifySpeechRoundTrip } from './config-command'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('speech config CLI', () => {
  it('verifies speech before saving its DPAPI profile and never returns the key', async () => {
    const root = await createRoot()
    const protector = reversibleProtector()
    const key = 'speech-private-token'
    let verified: MimoSpeechConfig | undefined

    const result = await invoke(
      root,
      [
        'config',
        'set',
        'speech',
        '--url',
        'https://speech.example.test/v1',
        '--tts-model',
        'mimo-v2.5-tts',
        '--asr-model',
        'mimo-v2.5-asr',
        '--key-stdin',
        '--json',
      ],
      {
        secretProtector: protector,
        secretInput: { readStdin: async () => key, readHidden: async () => key },
        verifySpeechProvider: async (config) => {
          verified = config
        },
      },
    )

    expect(result.code).toBe(0)
    expect(verified).toMatchObject({
      baseUrl: 'https://speech.example.test/v1',
      apiKey: key,
      ttsModel: 'mimo-v2.5-tts',
      asrModel: 'mimo-v2.5-asr',
    })
    expect(result.raw).not.toContain(key)
    expect(result.payload).toMatchObject({
      ok: true,
      command: 'config.set.speech',
      data: { speech: { configured: true, ttsModel: 'mimo-v2.5-tts', asrModel: 'mimo-v2.5-asr' } },
    })
    expect(await readFile(join(root, 'PurpleInk', 'config.json'), 'utf8')).not.toContain(key)
  })

  it('keeps the previous speech key when replacement verification fails', async () => {
    const root = await createRoot()
    const protector = reversibleProtector()
    await invoke(root, setSpeechArgs('https://working.example.test/v1'), {
      secretProtector: protector,
      secretInput: secret('working-speech-token'),
      verifySpeechProvider: async () => undefined,
    })
    const configPath = join(root, 'PurpleInk', 'config.json')
    const beforeConfig = await readFile(configPath, 'utf8')
    const beforeSecrets = await snapshot(join(root, 'PurpleInk', 'secrets'))

    const failed = await invoke(root, setSpeechArgs('https://bad.example.test/v1'), {
      secretProtector: protector,
      secretInput: secret('replacement-speech-token'),
      verifySpeechProvider: async () => {
        throw new Error('private-provider-response')
      },
    })

    expect(failed.code).toBe(1)
    expect(failed.raw).not.toContain('replacement-speech-token')
    expect(failed.raw).not.toContain('private-provider-response')
    expect(failed.payload).toMatchObject({
      error: { code: 'CONFIG_VERIFICATION_FAILED', retryable: true },
    })
    expect(await readFile(configPath, 'utf8')).toBe(beforeConfig)
    expect(await snapshot(join(root, 'PurpleInk', 'secrets'))).toEqual(beforeSecrets)
  })

  it('verifies text, TTS, and ASR through config verify all', async () => {
    const root = await createRoot()
    const common = {
      secretProtector: reversibleProtector(),
      verifyTextProvider: async () => undefined,
      verifySpeechProvider: async () => undefined,
    }
    await invoke(
      root,
      ['config', 'set', 'text', '--url', 'https://text.test/v1', '--model', 'text-model', '--key-stdin'],
      {
        ...common,
        secretInput: secret('text-token'),
      },
    )
    await invoke(root, setSpeechArgs('https://speech.test/v1'), {
      ...common,
      secretInput: secret('speech-token'),
    })
    let textCalls = 0
    let speechCalls = 0

    const verified = await invoke(root, ['config', 'verify', 'all', '--json'], {
      ...common,
      verifyTextProvider: async () => {
        textCalls += 1
      },
      verifySpeechProvider: async () => {
        speechCalls += 1
      },
    })

    expect(verified.code).toBe(0)
    expect(textCalls).toBe(1)
    expect(speechCalls).toBe(1)
    expect(verified.payload).toMatchObject({
      ok: true,
      command: 'config.verify.all',
      data: { target: 'all', text: { verified: true }, speech: { tts: true, asr: true } },
    })
  })
})

describe('verifySpeechRoundTrip', () => {
  it('writes a temporary WAV for ASR and removes the temporary directory in finally', async () => {
    const root = await createRoot()
    const wav = syntheticWav()
    let asrBytes: Uint8Array | undefined
    const client: MimoSpeechClient = {
      synthesize: async () => ({ audio: wav, mimeType: 'audio/wav' }),
      transcribe: async ({ audio }) => {
        asrBytes = audio
        return { text: '连通性验证' }
      },
    }

    await verifySpeechRoundTrip(baseSpeechConfig(), { client, temporaryRoot: root })

    expect(Buffer.from(asrBytes ?? [])).toEqual(wav)
    expect(await readdir(root)).toEqual([])
  })

  it('also removes the temporary directory when ASR fails', async () => {
    const root = await createRoot()
    const client: MimoSpeechClient = {
      synthesize: async () => ({ audio: syntheticWav(), mimeType: 'audio/wav' }),
      transcribe: async () => {
        throw new Error('synthetic failure')
      },
    }

    await expect(verifySpeechRoundTrip(baseSpeechConfig(), { client, temporaryRoot: root })).rejects.toBeDefined()
    expect(await readdir(root)).toEqual([])
  })
})

function setSpeechArgs(url: string): string[] {
  return [
    'config',
    'set',
    'speech',
    '--url',
    url,
    '--tts-model',
    'mimo-v2.5-tts',
    '--asr-model',
    'mimo-v2.5-asr',
    '--key-stdin',
    '--json',
  ]
}

function secret(value: string) {
  return { readStdin: async () => value, readHidden: async () => value }
}

function baseSpeechConfig(): MimoSpeechConfig {
  return {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiKey: 'synthetic-token',
    ttsModel: 'mimo-v2.5-tts',
    voiceCloneModel: 'mimo-v2.5-tts-voiceclone',
    asrModel: 'mimo-v2.5-asr',
  }
}

function syntheticWav(): Buffer {
  const bytes = Buffer.alloc(46)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('data', 36, 'ascii')
  return bytes
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-speech-config-'))
  roots.push(root)
  return root
}

function reversibleProtector() {
  return {
    protect: async (value: string): Promise<Uint8Array> => Buffer.from(value, 'utf8').reverse(),
    unprotect: async (value: Uint8Array): Promise<string> => Buffer.from(value).reverse().toString('utf8'),
  }
}

async function invoke(root: string, argv: string[], runtime: CliRuntimeOptions = {}) {
  const lines: string[] = []
  const code = await runCli(
    argv,
    { LOCALAPPDATA: root },
    { writeLine: (line) => lines.push(line) },
    { localAppData: root, stdinIsTty: false, ...runtime },
  )
  const raw = lines.join('\n')
  return { code, raw, payload: JSON.parse(raw) as unknown }
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const file of (await readdir(directory)).sort())
    result[file] = (await readFile(join(directory, file))).toString('base64')
  return result
}
