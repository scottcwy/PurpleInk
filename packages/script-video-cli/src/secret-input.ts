import type { ReadStream, WriteStream } from 'node:tty'

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
    readHidden: () => readHidden(input as ReadStream, output as WriteStream),
  }
}

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  let value = ''
  for await (const chunk of input) value += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  return normalizeSecret(value)
}

function readHidden(input: ReadStream, output: WriteStream): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new SafeCliError('KEY_INPUT_REQUIRED', '非交互环境必须使用 --key-stdin。', false, 400)
  }
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const wasRaw = input.isRaw
    const finish = (error?: Error): void => {
      input.off('data', onData)
      input.setRawMode(Boolean(wasRaw))
      output.write('\n')
      if (error) reject(error)
      else {
        try {
          resolve(normalizeSecret(value))
        } catch (caught) {
          reject(caught)
        }
      }
    }
    const onData = (chunk: Buffer | string): void => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      for (const character of text) {
        if (character === '\u0003') {
          finish(new SafeCliError('KEY_INPUT_CANCELLED', '密钥输入已取消。', false, 400))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\b' || character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    output.write('API Key: ')
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

export function normalizeSecret(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new SafeCliError('KEY_INPUT_EMPTY', 'API Key 不能为空。', false, 400)
  return normalized
}
