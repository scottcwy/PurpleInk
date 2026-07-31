import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import {
  aiCatalogSchema,
  assertCatalogIntegrity,
  billingCatalogSchema,
  plansCatalogSchema,
  type AiCatalogSource,
  type BillingCatalogSource,
  type PlansCatalogSource,
} from './ai-billing-catalog-schema'

const ROOT = process.cwd()
const OUTPUT = path.join(
  ROOT,
  'src',
  'lib',
  'config',
  'generated',
  'ai-billing-manifest.ts',
)

interface Sources {
  ai: AiCatalogSource
  billing: BillingCatalogSource
  plans: PlansCatalogSource
}

export async function loadCatalogSources(root = ROOT): Promise<Sources> {
  const [ai, billing, plans] = await Promise.all([
    readYaml(path.join(root, 'config', 'ai-catalog.yaml')),
    readYaml(path.join(root, 'config', 'billing-catalog.yaml')),
    readYaml(path.join(root, 'config', 'plans.yaml')),
  ])
  const sources = {
    ai: aiCatalogSchema.parse(ai),
    billing: billingCatalogSchema.parse(billing),
    plans: plansCatalogSchema.parse(plans),
  }
  assertCatalogIntegrity(sources)
  return sources
}

export function renderManifest(sources: Sources): string {
  const channels = new Map(
    sources.ai.channels.map((channel) => [channel.id, channel]),
  )
  const manifest = {
    schemaVersion: 1,
    catalogVersions: {
      ai: sources.ai.catalogVersion,
      billing: sources.billing.catalogVersion,
      plans: sources.plans.catalogVersion,
    },
    providers: sources.ai.providers,
    channels: sources.ai.channels,
    deployments: sources.ai.deployments.map((deployment) => {
      const channel = channels.get(deployment.channelId)
      if (!channel) throw new Error(`missing channel ${deployment.channelId}`)
      return {
        ...deployment,
        providerId: channel.providerId,
        funding: channel.funding,
        adapter: channel.adapter,
        baseUrl: channel.baseUrl,
        secretRef: channel.secretRef,
        providerPoolId: channel.id,
        failureDomainId: channel.pool.failureDomain,
        maxInFlight: channel.pool.maxInFlight,
      }
    }),
    fxRates: sources.billing.fxRates,
    serviceMultipliers: sources.billing.serviceMultipliers,
    rateCards: sources.billing.rateCards,
    plans: sources.plans.plans,
  }
  const providers = JSON.stringify(
    sources.ai.providers.map((provider) => provider.id),
  )
  return [
    '/* eslint-disable */',
    '// 此文件由 config/*.yaml 生成；禁止手工修改。',
    `export const BUILT_IN_PROVIDER_IDS = ${providers} as const`,
    '',
    'export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number]',
    '',
    `export const AI_BILLING_MANIFEST = ${JSON.stringify(manifest)} as const`,
    '',
  ].join('\n')
}

async function readYaml(file: string): Promise<unknown> {
  return parse(await readFile(file, 'utf8'))
}

async function main(): Promise<void> {
  const sources = await loadCatalogSources()
  const rendered = renderManifest(sources)
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '')
    if (current !== rendered) {
      throw new Error('AI billing manifest is stale; run pnpm generate:ai-catalog')
    }
    return
  }
  if (!process.argv.includes('--write')) {
    throw new Error('expected --write or --check')
  }
  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, rendered, 'utf8')
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
