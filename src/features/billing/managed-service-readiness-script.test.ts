import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve('scripts/verify/managed-service-readiness.mjs')
const variableNames = [
  'CVC_MANAGED_STEPFUN_API_KEY',
  'CVC_MANAGED_MIMO_API_KEY',
  'CVC_MANAGED_GEMINI_API_KEY',
  'CVC_REDEMPTION_CODE_PEPPER',
] as const

describe('managed service readiness script', () => {
  it('reports configured state without exposing values', () => {
    const secrets = Object.fromEntries(variableNames.map((name, index) => [
      name,
      `must-not-leak-${index}`,
    ]))
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, ...secrets },
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      managedServices: variableNames.map((name) => ({ name, status: 'configured' })),
    })
    for (const value of Object.values(secrets)) {
      expect(result.stdout).not.toContain(value)
      expect(result.stderr).not.toContain(value)
    }
  })

  it('fails closed when a required variable is missing', () => {
    const env = { ...process.env }
    for (const name of variableNames) delete env[name]
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env,
    })

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      managedServices: variableNames.map((name) => ({ name, status: 'missing' })),
    })
  })
})
