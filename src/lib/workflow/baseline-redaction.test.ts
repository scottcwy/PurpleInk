import { afterEach, describe, expect, it } from 'vitest'
import { redactBaselineOutput } from '../../../scripts/verify/capture-v3-baseline'

const TEST_ENV_NAME = 'CVC_BASELINE_TEST_TOKEN'
const originalTestSecret = process.env[TEST_ENV_NAME]

afterEach(() => {
  if (originalTestSecret === undefined) {
    delete process.env[TEST_ENV_NAME]
    return
  }
  process.env[TEST_ENV_NAME] = originalTestSecret
})

describe('redactBaselineOutput', () => {
  it('移除凭据、认证头、私钥块与继承环境 secret', () => {
    const inheritedSecret = 'fake-inherited-secret-0123456789'
    process.env[TEST_ENV_NAME] = inheritedSecret
    const output = redactBaselineOutput(
      [
        'Authorization: Basic ZmFrZTpmYWtl',
        'Proxy-Authorization=Bearer fake-proxy-token',
        'DATABASE_URL=postgres://alice:password@db.example/test',
        'SERVICE_DSN=opaque-dsn-value',
        'Set-Cookie: session=fake-cookie',
        'https://example.test/x?api_key=fake-query-key',
        '-----BEGIN PRIVATE KEY-----',
        'fake-private-material',
        '-----END PRIVATE KEY-----',
        inheritedSecret,
      ].join('\n')
    )

    for (const forbidden of [
      'ZmFrZTpmYWtl',
      'fake-proxy-token',
      'alice:password',
      'opaque-dsn-value',
      'fake-cookie',
      'fake-query-key',
      'fake-private-material',
      inheritedSecret,
    ]) {
      expect(output).not.toContain(forbidden)
    }
  })

  it('移除 Windows/UNC 绝对路径和长 token，同时保留安全文本', () => {
    const output = redactBaselineOutput(
      [
        String.raw`失败位置 X:\Users\Example User\secret.txt`,
        '失败位置 X:/tmp/example/secret.txt',
        String.raw`失败位置 \\server\share\secret.txt`,
        'opaque abcdefghijklmnopqrstuvwx12345678',
        'safe line',
      ].join('\n')
    )

    expect(output).not.toMatch(/[A-Z]:[\\/]/i)
    expect(output).not.toContain('\\\\server\\share')
    expect(output).not.toContain('abcdefghijklmnopqrstuvwx12345678')
    expect(output).toContain('safe line')
  })
})
