import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { SafeCliError } from './safe-error'

export interface SecretProtector {
  protect(value: string): Promise<Uint8Array>
  unprotect(value: Uint8Array): Promise<string>
}

export interface DpapiProcessRequest {
  executable: string
  args: readonly string[]
  stdin: string
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
}

export type DpapiProcessRunner = (request: DpapiProcessRequest) => Promise<string>

export interface WindowsDpapiOptions {
  runner?: DpapiProcessRunner
  platform?: string
  systemRoot?: string
  pathExists?: (path: string) => boolean
  timeoutMs?: number
  maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

const protectScript = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$plain = [Console]::In.ReadToEnd()',
  '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$sealed = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)',
  '[Console]::Out.Write([Convert]::ToBase64String($sealed))',
].join('; ')

const unprotectScript = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$encoded = [Console]::In.ReadToEnd()',
  '$sealed = [Convert]::FromBase64String($encoded)',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, $scope)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
].join('; ')

export class WindowsCurrentUserDpapiProtector implements SecretProtector {
  private readonly runner: DpapiProcessRunner
  private readonly platform: string
  private readonly systemRoot: string | undefined
  private readonly pathExists: (path: string) => boolean
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number

  constructor(options: WindowsDpapiOptions = {}) {
    this.runner = options.runner ?? createDpapiProcessRunner()
    this.platform = options.platform ?? process.platform
    this.systemRoot = options.systemRoot ?? process.env.SystemRoot
    this.pathExists = options.pathExists ?? existsSync
    this.timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000)
    this.maxOutputBytes = boundedOption(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1, 16 * 1024 * 1024)
  }

  async protect(value: string): Promise<Uint8Array> {
    const encoded = await this.runPowerShell(protectScript, value)
    return decodeBase64(encoded)
  }

  async unprotect(value: Uint8Array): Promise<string> {
    return this.runPowerShell(unprotectScript, Buffer.from(value).toString('base64'))
  }

  private runPowerShell(script: string, stdin: string): Promise<string> {
    const executable = resolveTrustedPowerShell(this.platform, this.systemRoot, this.pathExists)
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
    return this.runner({
      executable,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
      stdin,
      cwd: dirname(executable),
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    })
  }
}

export function createDpapiProcessRunner(spawnProcess: typeof spawn = spawn): DpapiProcessRunner {
  return (request) =>
    new Promise<string>((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawnProcess(request.executable, [...request.args], {
          cwd: request.cwd,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        })
      } catch {
        reject(protectionFailed())
        return
      }
      if (!child.stdin || !child.stdout) {
        child.kill()
        reject(protectionFailed())
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        child.off('error', onProcessError)
        child.off('close', onClose)
        child.stdin?.off('error', onStdinError)
        child.stdout?.off('error', onStdoutError)
        child.stdout?.off('data', onData)
      }
      const fail = (kill: boolean): void => {
        if (settled) return
        settled = true
        cleanup()
        if (kill) {
          try {
            child.kill()
          } catch {
            /* process failure is already safely projected */
          }
        }
        reject(protectionFailed())
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(Buffer.concat(chunks).toString('utf8').trim())
      }
      const onData = (chunk: Buffer): void => {
        size += chunk.byteLength
        if (size > request.maxOutputBytes) fail(true)
        else chunks.push(chunk)
      }
      const onProcessError = (): void => fail(true)
      const onStdinError = (): void => fail(true)
      const onStdoutError = (): void => fail(true)
      const onClose = (code: number | null): void => {
        if (code === 0) succeed()
        else fail(false)
      }

      child.on('error', onProcessError)
      child.on('close', onClose)
      child.stdin.on('error', onStdinError)
      child.stdout.on('error', onStdoutError)
      child.stdout.on('data', onData)
      timer = setTimeout(() => fail(true), request.timeoutMs)
      try {
        child.stdin.end(request.stdin, 'utf8')
      } catch {
        fail(true)
      }
    })
}

function resolveTrustedPowerShell(
  platform: string,
  systemRoot: string | undefined,
  pathExists: (path: string) => boolean,
): string {
  if (platform !== 'win32' || !systemRoot || !isAbsolute(systemRoot)) {
    throw new SafeCliError('DPAPI_UNAVAILABLE', 'CurrentUser DPAPI 仅支持 Windows。', false, 500)
  }
  const candidates = ['Sysnative', 'System32'].map((systemDirectory) =>
    join(systemRoot, systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  )
  const executable = candidates.find((candidate) => isAbsolute(candidate) && pathExists(candidate))
  if (!executable) {
    throw new SafeCliError('DPAPI_UNAVAILABLE', '无法定位可信 Windows PowerShell。', false, 500)
  }
  return executable
}

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/iu.test(value)) throw protectionFailed()
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength === 0 || decoded.toString('base64') !== value) throw protectionFailed()
  return decoded
}

function boundedOption(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw protectionFailed()
  return value
}

function protectionFailed(): SafeCliError {
  return new SafeCliError('DPAPI_FAILED', '无法访问本机 CurrentUser 密钥存储。', false, 500)
}
