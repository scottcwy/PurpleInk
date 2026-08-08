import { createServer, type Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AiProviderError,
  createOpenAiCompatibleClient,
} from './openai-compatible'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('OpenAI-compatible client', () => {
  it('sends chat completions and parses fenced JSON', async () => {
    let receivedBody = ''
    let receivedAuthorization = ''
    const server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization ?? ''
      request.on('data', (chunk) => {
        receivedBody += chunk.toString()
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
          }),
        )
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')

    const client = createOpenAiCompatibleClient({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'secret-token',
      textModel: 'text-model',
      requestTimeoutMs: 1_000,
      maxRetries: 0,
    })

    await expect(
      client.completeJson({ system: 'system', user: 'user' }),
    ).resolves.toEqual({ ok: true })
    expect(receivedAuthorization).toBe('Bearer secret-token')
    expect(JSON.parse(receivedBody)).toMatchObject({
      model: 'text-model',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
      ],
    })
  })

  it('retries a rate limit and hides provider response details', async () => {
    let calls = 0
    const server = createServer((_request, response) => {
      calls += 1
      if (calls === 1) {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'secret upstream payload' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'done' } }] }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')

    const client = createOpenAiCompatibleClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'secret-token',
      textModel: 'text-model',
      requestTimeoutMs: 1_000,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    })

    await expect(client.completeText({ system: 's', user: 'u' })).resolves.toBe('done')
    expect(calls).toBe(2)

    const failedServer = createServer((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'secret upstream payload' }))
    })
    servers.push(failedServer)
    await new Promise<void>((resolve) => failedServer.listen(0, '127.0.0.1', () => resolve()))
    const failedAddress = failedServer.address()
    if (!failedAddress || typeof failedAddress === 'string') throw new Error('server did not bind')
    const failedClient = createOpenAiCompatibleClient({
      baseUrl: `http://127.0.0.1:${failedAddress.port}`,
      apiKey: 'secret-token',
      textModel: 'text-model',
      requestTimeoutMs: 1_000,
      maxRetries: 0,
    })

    await expect(failedClient.completeText({ system: 's', user: 'u' })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiProviderError
        && error.code === 'AI_PROVIDER_UNAVAILABLE'
        && !error.message.includes('secret'),
    )
  })
})
