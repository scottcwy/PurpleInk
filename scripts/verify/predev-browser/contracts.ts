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

export interface ComposeIsolation {
  networks: readonly string[]
  volumes: readonly string[]
  ports: readonly { service: string; hostIp: string; target: number }[]
}

export interface ImageAttestation {
  image: string
  revision: string | null
}

type PredevImageName = Record<'web' | 'worker' | 'migrate', string>

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

export function verifyComposeIsolation(config: ComposeIsolation, project: string): void {
  requireIsolatedProjectName(project)
  if (!config.networks.every((name) => name.startsWith(`${project}_`))) {
    throw new Error('all networks must use the temporary project prefix')
  }
  if (!config.volumes.every((name) => name.startsWith(`${project}_`))) {
    throw new Error('all volumes must use the temporary project prefix')
  }
  for (const port of config.ports) {
    const expected = port.service === 'caddy' ? 443 : port.service === 'postgres' ? 5432 : null
    if (port.hostIp !== '127.0.0.1' || port.target !== expected) {
      throw new Error('only Caddy HTTPS and Postgres may publish loopback ports')
    }
  }
}

export function selectVerifiedImages(
  revision: string,
  images: Record<'web' | 'worker' | 'migrate', ImageAttestation>,
): { mode: 'no-build'; images: Record<'web' | 'worker' | 'migrate', string> } | { mode: 'build'; images: null } {
  const expected = expectedAttestedImageNames(revision)
  if (
    images.web.revision === revision && images.web.image === expected.web &&
    images.worker.revision === revision && images.worker.image === expected.worker &&
    images.migrate.revision === revision && images.migrate.image === expected.migrate
  ) {
    return { mode: 'no-build', images: expected }
  }
  return { mode: 'build', images: null }
}

export function expectedAttestedImageNames(revision: string): PredevImageName {
  const tag = revision.slice(0, 12)
  return {
    web: `purpleink-web:predev-${tag}`,
    worker: `purpleink-worker:predev-${tag}`,
    migrate: `purpleink-migrate:predev-${tag}`,
  }
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
