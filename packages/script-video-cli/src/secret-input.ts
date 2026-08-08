import type { ReadStream } from 'node:tty'

import { SafeCliError } from './safe-error'

export interface SecretInput {
  readStdin(): Promise<string>
  readHidden(): Promise<string>
}

export function createProcessSecretInput(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): SecretInput {
  return {
    readStdin: () => readAll(input),
    readHidden: () => readHidden(input as ReadStream, output),
  }
}

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  let value = ''
  for await (const chunk of input) value += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  return normalizeSecret(value)
}

function readHidden(input: ReadStream, output: NodeJS.WritableStream): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new SafeCliError('KEY_INPUT_REQUIRED', '非交互环境必须使用 --key-stdin。', false, 400)
  }
  let value = ''
  let settled = false
  const wasRaw = Boolean(input.isRaw)
  const wasFlowing = input.readableFlowing
  const startedFlow = wasFlowing !== true
  let onData: (chunk: Buffer | string) => void
  let onError: () => void
  let onInterrupted: () => void

  const pending = new Promise<string>((resolve, reject) => {
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      try {
        resolve(normalizeSecret(value))
      } catch (error) {
        reject(error)
      }
    }
    onData = (chunk: Buffer | string): void => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      for (const character of text) {
        if (character === '\u0003') {
          fail(new SafeCliError('KEY_INPUT_CANCELLED', '密钥输入已取消。', false, 400))
          return
        }
        if (character === '\r' || character === '\n') {
          succeed()
          return
        }
        if (character === '\b' || character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    onError = (): void => fail(new SafeCliError('KEY_INPUT_FAILED', '无法读取隐藏密钥。', false, 400))
    onInterrupted = (): void => fail(new SafeCliError('KEY_INPUT_INTERRUPTED', '密钥输入流已结束。', false, 400))
    try {
      input.on('data', onData)
      input.on('error', onError)
      input.on('end', onInterrupted)
      input.on('close', onInterrupted)
      output.write('API Key: ')
      input.setRawMode(true)
      if (startedFlow) input.resume()
    } catch {
      fail(new SafeCliError('KEY_INPUT_FAILED', '无法读取隐藏密钥。', false, 400))
    }
  })

  return pending.finally(() => {
    input.off('data', onData)
    input.off('error', onError)
    input.off('end', onInterrupted)
    input.off('close', onInterrupted)
    try {
      input.setRawMode(wasRaw)
    } catch {
      /* preserve the already settled safe result */
    }
    if (startedFlow) {
      try {
        input.pause()
      } catch {
        /* preserve the already settled safe result */
      }
    }
    try {
      output.write('\n')
    } catch {
      /* preserve the already settled safe result */
    }
  })
}

export function normalizeSecret(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new SafeCliError('KEY_INPUT_EMPTY', 'API Key 不能为空。', false, 400)
  return normalized
}
