import { randomBytes } from 'node:crypto'
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const Module = require('node:module') as typeof import('node:module')
const resolver = Module as unknown as {
  _resolveFilename: (...args: unknown[]) => string
}
const originalResolve = resolver._resolveFilename
resolver._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
  if (request === 'server-only') return require.resolve('../setup/server-only-stub.js')
  return originalResolve.call(this, request, ...rest)
}

const PLAN_KEYS = ['free', 'plus', 'pro', 'max'] as const
type PlanKey = (typeof PLAN_KEYS)[number]
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

interface BatchSpec {
  plan: Exclude<PlanKey, 'free'>
  count: number
}

function parseBatchSpec(value: string): BatchSpec {
  const [plan, rawCount, ...extra] = value.split(':')
  const count = Number(rawCount)
  if (
    extra.length > 0
    || !PLAN_KEYS.includes(plan as PlanKey)
    || plan === 'free'
  ) {
    throw new Error('--specs entries must use plus|pro|max:count')
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
    throw new Error('each redemption code count must be between 1 and 1000')
  }
  return { plan: plan as BatchSpec['plan'], count }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parseSpecs(): BatchSpec[] {
  if (process.argv.includes('--initial')) {
    return [
      { plan: 'plus', count: 10 },
      { plan: 'pro', count: 5 },
      { plan: 'max', count: 2 },
    ]
  }
  const combined = argument('--specs')
  if (combined) {
    const specs = combined.split(',').map((entry) => parseBatchSpec(entry.trim()))
    if (specs.length === 0 || new Set(specs.map(({ plan }) => plan)).size !== specs.length) {
      throw new Error('--specs must contain unique membership plans')
    }
    return specs
  }
  const plan = argument('--plan')
  const count = Number(argument('--count'))
  if (!PLAN_KEYS.includes(plan as PlanKey)) {
    throw new Error('--plan must be free | plus | pro | max')
  }
  if (plan === 'free') throw new Error('Free redemption codes cannot be generated')
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
    throw new Error('--count must be an integer between 1 and 1000')
  }
  return [{ plan, count } as BatchSpec]
}

function generateCode(plan: BatchSpec['plan']): string {
  let value = BigInt(`0x${randomBytes(16).toString('hex')}`)
  let encoded = ''
  for (let index = 0; index < 26; index += 1) {
    encoded = ALPHABET[Number(value & BigInt(31))]! + encoded
    value >>= BigInt(5)
  }
  return `PI-${plan.toUpperCase()}-${encoded.match(/.{1,5}/g)!.join('-')}`
}

async function ensurePepper(provision: boolean): Promise<void> {
  if (process.env.CVC_REDEMPTION_CODE_PEPPER?.trim()) return
  if (!provision) throw new Error('CVC_REDEMPTION_CODE_PEPPER is required')
  const envPath = resolve('.env.local')
  const existing = await readFile(envPath, 'utf8').catch(() => '')
  if (/^CVC_REDEMPTION_CODE_PEPPER=/m.test(existing)) {
    throw new Error('CVC_REDEMPTION_CODE_PEPPER exists but is empty')
  }
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  const pepper = randomBytes(32).toString('base64url')
  await appendFile(envPath, `${separator}CVC_REDEMPTION_CODE_PEPPER=${pepper}\n`, {
    encoding: 'utf8',
  })
  process.env.CVC_REDEMPTION_CODE_PEPPER = pepper
}

async function main(): Promise<void> {
  const specs = parseSpecs()
  const output = argument('--out')
  if (!output || !isAbsolute(output)) throw new Error('--out must be an absolute path')
  const outputPath = resolve(output)
  const workspace = resolve(process.cwd())
  const rel = relative(workspace, outputPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('--out must be outside the repository')
  }

  const { loadEnvConfig } = await import('@next/env')
  loadEnvConfig(process.cwd())
  await ensurePepper(process.argv.includes('--provision-pepper'))
  const [{ getDb }, schema, { hashRedemptionCode }] = await Promise.all([
    import('../../src/lib/db/client'),
    import('../../src/lib/db/schema/index'),
    import('../../src/features/billing/redemption'),
  ])
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000)
  const batches = specs.map((spec) => ({
    ...spec,
    codes: Array.from({ length: spec.count }, () => generateCode(spec.plan)),
  }))
  const plaintext = [
    '# PurpleInk one-time redemption codes',
    `# generatedAt=${now.toISOString()}`,
    `# redeemBefore=${expiresAt.toISOString()}`,
    ...batches.flatMap((batch) => [
      '',
      `[${batch.plan.toUpperCase()} 30 days]`,
      ...batch.codes,
    ]),
    '',
  ].join('\n')

  let wroteOutput = false
  try {
    const database = await getDb()
    await database.transaction(async (tx) => {
      for (const batch of batches) {
        const [created] = await tx.insert(schema.redemptionBatches).values({
          planKey: batch.plan,
          durationDays: 30,
          label: `${process.argv.includes('--initial') ? 'initial' : 'generated'}-${batch.plan}-${now.toISOString()}`,
          expiresAt,
        }).returning({ id: schema.redemptionBatches.id })
        await tx.insert(schema.redemptionCodes).values(batch.codes.map((code) => ({
          batchId: created!.id,
          codeHash: hashRedemptionCode(code),
        })))
      }
      await writeFile(outputPath, plaintext, { encoding: 'utf8', flag: 'wx' })
      wroteOutput = true
    })
  } catch (error) {
    if (wroteOutput) await rm(outputPath)
    throw error
  }
  process.stdout.write(
    `Created ${batches.reduce((sum, batch) => sum + batch.count, 0)} one-time codes at ${outputPath}\n`,
  )
  process.exit(0)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
