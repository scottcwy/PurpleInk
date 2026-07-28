import 'server-only'
import {
  managedCredentialUnavailableError,
  type ManagedProviderId,
} from './managed-service'

export const MANAGED_CREDENTIAL_ENV = {
  stepfun: 'CVC_MANAGED_STEPFUN_API_KEY',
  mimo: 'CVC_MANAGED_MIMO_API_KEY',
  gemini: 'CVC_MANAGED_GEMINI_API_KEY',
} as const satisfies Record<ManagedProviderId, string>

/**
 * 只读取平台托管 credential。BYOK 继续走加密 credential store，绝不回退到这里。
 */
export function resolveManagedCredential(
  provider: ManagedProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[MANAGED_CREDENTIAL_ENV[provider]]?.trim()
  return value || null
}

export function requireManagedCredential(
  provider: ManagedProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const credential = resolveManagedCredential(provider, env)
  if (!credential) throw managedCredentialUnavailableError()
  return credential
}
