import 'server-only'
import {
  AI_BILLING_MANIFEST,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-billing-manifest'

export async function validateOfficialByokKey(
  providerId: BuiltInProviderId,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const channel = AI_BILLING_MANIFEST.channels.find((candidate) =>
    candidate.providerId === providerId && candidate.funding === 'byok')
  if (!channel) return false
  const headers: Record<string, string> = providerId === 'anthropic'
    ? {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    : providerId === 'mimo'
      ? { 'api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` }
  try {
    const response = await fetcher(
      `${channel.baseUrl.replace(/\/+$/, '')}/models`,
      {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    )
    return response.ok
  } catch {
    return false
  }
}
