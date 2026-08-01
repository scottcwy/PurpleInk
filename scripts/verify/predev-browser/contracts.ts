export interface EvidenceManifestInput {
  commit: string
  baseUrl: string
  composeProject: string
  secretValues: readonly string[]
  facts: unknown
}

export interface AdminGuardResult {
  target: string
  unauthenticated: number
  user: number
  admin: number
}

export interface MediaRangeResult {
  fullHash: string
  localHash: string
  status: number
  contentRange: string | null
  bytes: number
}

export function createEvidenceManifest(input: EvidenceManifestInput): Record<string, unknown> {
  return {
    commit: input.commit,
    baseUrl: input.baseUrl,
    composeProject: requireIsolatedProjectName(input.composeProject),
    facts: redactEvidence(input.facts, input.secretValues),
  }
}

export function requireIsolatedProjectName(name: string): string {
  if (!/^purpleink_predev_[a-z0-9]{8,}$/.test(name)) {
    throw new Error('expected a uniquely owned temporary Compose project name')
  }
  return name
}

export function verifyAdminGuardMatrix(results: readonly AdminGuardResult[]): void {
  for (const result of results) {
    const expectedUnauthenticated = result.target.startsWith('/api/') ? 401 : 307
    if (result.unauthenticated !== expectedUnauthenticated) {
      throw new Error(`${result.target}: unauthenticated expected ${expectedUnauthenticated}`)
    }
    if (result.user !== 404) throw new Error(`${result.target}: ordinary user expected 404`)
    if (result.admin < 200 || result.admin >= 300) {
      throw new Error(`${result.target}: admin expected 2xx`)
    }
  }
}

export function verifyMediaRange(result: MediaRangeResult): void {
  if (result.fullHash !== result.localHash) throw new Error('download hash does not match local media')
  if (result.status !== 206 || !result.contentRange?.startsWith('bytes 0-')) {
    throw new Error('range response must be HTTP 206 with a byte content-range')
  }
  if (result.bytes <= 0) throw new Error('range response was empty')
}

function redactEvidence(value: unknown, secretValues: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secretValues)
  if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, secretValues))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactEvidence(entry, secretValues)]),
    )
  }
  return value
}

function redactString(value: string, secretValues: readonly string[]): string {
  return secretValues.reduce(
    (redacted, secret) => secret.length > 0 ? redacted.replaceAll(secret, '[REDACTED]') : redacted,
    value,
  )
}
