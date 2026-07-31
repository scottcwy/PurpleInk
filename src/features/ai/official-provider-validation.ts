import 'server-only'
import {
  AI_BILLING_MANIFEST,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-billing-manifest'

type OfficialValidationProvider = Extract<
  BuiltInProviderId,
  'openai' | 'anthropic'
>

export async function validateOfficialByokKey(
  providerId: OfficialValidationProvider,
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
    : { Authorization: `Bearer ${apiKey}` }
  try {
    const response = await fetcher(
      `${channel.baseUrl.replace(/\/+$/, '')}/models`,
      { method: 'GET', headers, cache: 'no-store' },
    )
    return response.ok
  } catch {
    return false
  }
}
