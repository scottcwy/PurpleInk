import { spawn } from 'node:child_process'

import { SafeCliError } from './safe-error'

export interface SecretProtector {
  protect(value: string): Promise<Uint8Array>
  unprotect(value: Uint8Array): Promise<string>
}

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
  async protect(value: string): Promise<Uint8Array> {
    assertWindows()
    const encoded = await runPowerShell(protectScript, value)
    try {
      return Buffer.from(encoded, 'base64')
    } catch {
      throw protectionFailed()
    }
  }

  async unprotect(value: Uint8Array): Promise<string> {
    assertWindows()
    return runPowerShell(unprotectScript, Buffer.from(value).toString('base64'))
  }
}

function runPowerShell(script: string, stdin: string): Promise<string> {
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    )
    const chunks: Buffer[] = []
    let size = 0
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size <= 16 * 1024 * 1024) chunks.push(chunk)
    })
    child.on('error', () => reject(protectionFailed()))
    child.on('close', (code) => {
      if (code !== 0 || size > 16 * 1024 * 1024) reject(protectionFailed())
      else resolve(Buffer.concat(chunks).toString('utf8').trim())
    })
    child.stdin.end(stdin, 'utf8')
  })
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new SafeCliError('DPAPI_UNAVAILABLE', 'CurrentUser DPAPI 仅支持 Windows。', false, 500)
  }
}

function protectionFailed(): SafeCliError {
  return new SafeCliError('DPAPI_FAILED', '无法访问本机 CurrentUser 密钥存储。', false, 500)
}
