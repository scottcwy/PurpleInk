import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from './cli'

const roots: string[] = []
const servers: Server[] = []
const fixedNow = new Date('2026-08-09T12:34:56.000Z')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('local provider profiles', () => {
  it('shows safe defaults from the LOCALAPPDATA PurpleInk directory', async () => {
    const root = await createRoot()
    const result = await invoke(root, ['config', 'show', '--json'])

    expect(result.code).toBe(0)
    expect(result.payload).toEqual({
      ok: true,
      command: 'config.show',
      data: {
        text: { configured: false, baseUrl: null, model: null },
        speech: { configured: false, baseUrl: null, ttsModel: null, asrModel: null },
        concurrency: { run: 2, text: 6, browser: 3, tts: 3, asr: 2, render: 1 },
      },
    })
  })

  it('verifies through the formal client before atomically storing normalized text settings', async () => {
    const root = await createRoot()
    const provider = await createJsonProvider()
    const token = 'local-test-token-value'
    const protector = reversibleProtector()
    const result = await invoke(
      root,
      ['config', 'set', 'text', '--url', `${provider.baseUrl}/`, '--model', 'text-model', '--key-stdin', '--json'],
      { protector, stdinSecret: token },
    )

    expect(result.code).toBe(0)
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]).toMatchObject({
      authorization: `Bearer ${token}`,
      path: '/chat/completions',
      body: { model: 'text-model', response_format: { type: 'json_object' } },
    })
    const configPath = join(root, 'PurpleInk', 'config.json')
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(saved).toMatchObject({
      schemaVersion: 1,
      updatedAt: fixedNow.toISOString(),
      text: { baseUrl: `${provider.baseUrl}/`, model: 'text-model' },
      concurrency: { run: 2, text: 6, browser: 3, tts: 3, asr: 2, render: 1 },
    })
    expect(JSON.stringify(saved)).not.toContain(token)

    const secretDir = join(root, 'PurpleInk', 'secrets')
    const secretFiles = await readdir(secretDir)
    expect(secretFiles).toHaveLength(1)
    const encrypted = await readFile(join(secretDir, secretFiles[0]!))
    expect(encrypted.toString('utf8')).not.toContain(token)
    expect(protector.protectedValues).toEqual([token])
    expect((await readdir(join(root, 'PurpleInk'))).some((name) => name.includes('.tmp-'))).toBe(false)
    expect(secretFiles.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('normalizes only the designated legacy root URL and preserves every other valid URL verbatim', async () => {
    const root = await createRoot()
    const protector = reversibleProtector()
    const verifyTextProvider = async (): Promise<void> => undefined

    await invoke(
      root,
      ['config', 'set', 'text', '--url', 'https://api2.agentsnav.com/', '--model', 'model-a', '--key-stdin', '--json'],
      { protector, stdinSecret: 'first-test-token', verifyTextProvider },
    )
    expect(JSON.parse(await readFile(join(root, 'PurpleInk', 'config.json'), 'utf8'))).toMatchObject({
      text: { baseUrl: 'https://api2.agentsnav.com/v1' },
    })

    await invoke(
      root,
      [
        'config',
        'set',
        'text',
        '--url',
        'https://api.example.test/custom/path/?mode=fast#anchor',
        '--model',
        'model-b',
        '--key-stdin',
        '--json',
      ],
      { protector, stdinSecret: 'second-test-token', verifyTextProvider },
    )
    expect(JSON.parse(await readFile(join(root, 'PurpleInk', 'config.json'), 'utf8'))).toMatchObject({
      text: { baseUrl: 'https://api.example.test/custom/path/?mode=fast#anchor', model: 'model-b' },
    })

    await invoke(
      root,
      [
        'config',
        'set',
        'text',
        '--url',
        'https://api2.agentsnav.com/?mode=fast#anchor',
        '--model',
        'model-c',
        '--key-stdin',
        '--json',
      ],
      { protector, stdinSecret: 'third-test-token', verifyTextProvider },
    )
    expect(JSON.parse(await readFile(join(root, 'PurpleInk', 'config.json'), 'utf8'))).toMatchObject({
      text: { baseUrl: 'https://api2.agentsnav.com/?mode=fast#anchor', model: 'model-c' },
    })
  })

  it('does not overwrite a working profile when verification fails and projects only a safe error', async () => {
    const root = await createRoot()
    const protector = reversibleProtector()
    await invoke(
      root,
      [
        'config',
        'set',
        'text',
        '--url',
        'https://api.example.test/v1',
        '--model',
        'working-model',
        '--key-stdin',
        '--json',
      ],
      { protector, stdinSecret: 'working-test-token', verifyTextProvider: async () => undefined },
    )
    const configPath = join(root, 'PurpleInk', 'config.json')
    const beforeConfig = await readFile(configPath, 'utf8')
    const beforeSecrets = await snapshotDirectory(join(root, 'PurpleInk', 'secrets'))
    const upstreamDetail = 'private-upstream-response-marker'

    const failed = await invoke(
      root,
      [
        'config',
        'set',
        'text',
        '--url',
        'https://bad.example.test/v1',
        '--model',
        'broken-model',
        '--key-stdin',
        '--json',
      ],
      {
        protector,
        stdinSecret: 'replacement-test-token',
        verifyTextProvider: async () => {
          throw new Error(upstreamDetail)
        },
      },
    )

    expect(failed.code).toBe(1)
    expect(failed.raw).not.toContain(upstreamDetail)
    expect(failed.raw).not.toContain('replacement-test-token')
    expect(failed.payload).toEqual({
      ok: false,
      command: 'config.set.text',
      error: {
        code: 'CONFIG_VERIFICATION_FAILED',
        message: '文本模型连通性验证失败。',
        retryable: true,
      },
    })
    expect(Object.keys((failed.payload as { error: object }).error).sort()).toEqual(['code', 'message', 'retryable'])
    expect(await readFile(configPath, 'utf8')).toBe(beforeConfig)
    expect(await snapshotDirectory(join(root, 'PurpleInk', 'secrets'))).toEqual(beforeSecrets)
  })

  it('shows and verifies a stored profile without returning its key', async () => {
    const root = await createRoot()
    const protector = reversibleProtector()
    const token = 'show-test-token-value'
    await invoke(
      root,
      [
        'config',
        'set',
        'text',
        '--url',
        'https://api.example.test/v1',
        '--model',
        'text-model',
        '--key-stdin',
        '--json',
      ],
      { protector, stdinSecret: token, verifyTextProvider: async () => undefined },
    )

    const shown = await invoke(root, ['config', 'show', '--json'], { protector })
    expect(shown.raw).not.toContain(token)
    expect(shown.payload).toMatchObject({
      ok: true,
      command: 'config.show',
      data: { text: { configured: true, baseUrl: 'https://api.example.test/v1', model: 'text-model' } },
    })
    expect(shown.payload).not.toHaveProperty('data.configPath')
    expect(shown.payload).not.toHaveProperty('data.updatedAt')

    let verifiedKey = ''
    const verified = await invoke(root, ['config', 'verify', 'text', '--json'], {
      protector,
      verifyTextProvider: async (config: { apiKey: string }) => {
        verifiedKey = config.apiKey
      },
    })
    expect(verified.code).toBe(0)
    expect(verifiedKey).toBe(token)
    expect(verified.raw).not.toContain(token)
    expect(verified.payload).toMatchObject({
      ok: true,
      command: 'config.verify.text',
      data: { target: 'text', configured: true, verified: true },
    })
  })

  it('uses an injected hidden reader for interactive TTY input', async () => {
    const root = await createRoot()
    let hiddenReads = 0
    const result = await invoke(
      root,
      ['config', 'set', 'text', '--url', 'https://api.example.test/v1', '--model', 'text-model', '--json'],
      {
        protector: reversibleProtector(),
        stdinIsTty: true,
        secretInput: {
          readStdin: async () => {
            throw new Error('stdin reader must not be used')
          },
          readHidden: async () => {
            hiddenReads += 1
            return 'hidden-test-token'
          },
        },
        verifyTextProvider: async () => undefined,
      },
    )

    expect(result.code).toBe(0)
    expect(hiddenReads).toBe(1)
    expect(result.raw).not.toContain('hidden-test-token')
  })

  it('rejects --api-key without creating configuration files', async () => {
    const root = await createRoot()
    const result = await invoke(root, [
      'config',
      'set',
      'text',
      '--url',
      'https://api.example.test/v1',
      '--model',
      'text-model',
      '--api-key',
      'forbidden-value',
      '--json',
    ])

    expect(result.code).toBe(1)
    expect(result.raw).not.toContain('forbidden-value')
    expect(result.payload).toMatchObject({
      ok: false,
      error: { code: 'KEY_ARGUMENT_FORBIDDEN', retryable: false },
    })
    await expect(readdir(join(root, 'PurpleInk'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

interface RuntimeOverrides {
  protector?: ReturnType<typeof reversibleProtector>
  stdinSecret?: string
  stdinIsTty?: boolean
  secretInput?: {
    readStdin(): Promise<string>
    readHidden(): Promise<string>
  }
  verifyTextProvider?: (config: { baseUrl: string; apiKey: string; textModel: string }) => Promise<void>
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'purpleink-local-config-'))
  roots.push(root)
  return root
}

async function invoke(root: string, argv: string[], overrides: RuntimeOverrides = {}) {
  const lines: string[] = []
  const secretInput =
    overrides.secretInput ??
    ({
      readStdin: async () => overrides.stdinSecret ?? '',
      readHidden: async () => overrides.stdinSecret ?? '',
    } as const)
  const code = await runCli(
    argv,
    { LOCALAPPDATA: root },
    { writeLine: (line) => lines.push(line) },
    {
      localAppData: root,
      now: () => fixedNow,
      secretProtector: overrides.protector ?? reversibleProtector(),
      secretInput,
      stdinIsTty: overrides.stdinIsTty ?? false,
      verifyTextProvider: overrides.verifyTextProvider,
    },
  )
  const raw = lines.join('\n')
  return { code, raw, payload: JSON.parse(raw) as unknown }
}

function reversibleProtector() {
  const protectedValues: string[] = []
  return {
    protectedValues,
    protect: async (value: string): Promise<Uint8Array> => {
      protectedValues.push(value)
      return Buffer.from(value, 'utf8').reverse()
    },
    unprotect: async (value: Uint8Array): Promise<string> => Buffer.from(value).reverse().toString('utf8'),
  }
}

async function snapshotDirectory(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const name of (await readdir(directory)).sort()) {
    result[name] = (await readFile(join(directory, name))).toString('base64')
  }
  return result
}

async function createJsonProvider(): Promise<{
  baseUrl: string
  requests: Array<{ authorization: string; path: string; body: Record<string, unknown> }>
}> {
  const requests: Array<{ authorization: string; path: string; body: Record<string, unknown> }> = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      requests.push({
        authorization: request.headers.authorization ?? '',
        path: request.url ?? '',
        body: JSON.parse(body) as Record<string, unknown>,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('provider did not bind')
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}
