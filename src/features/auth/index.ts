/**
 * 认证域的公开边界。跨域调用只走这里（AGENTS.md §3）。
 *
 * 仓储（`auth-repository` / `verification-repository`）与派生密钥
 * （`signing-key`）刻意不导出：它们是本域内部实现，外部只应看到
 * 「会话」「守卫」「契约」三类能力。
 */
export {
  UNAUTHENTICATED_MESSAGE,
  currentSession,
  unauthenticatedResponse,
  withApiSession,
} from './api-session'

export { optionalSession, redirectIfAuthenticated, requireSession } from './page-session'

export { hashSessionToken, issueSession, resolveSession, revokeSession } from './session'
export type { IssuedSession, SessionOwner } from './session'

export { DEFAULT_POST_LOGIN_PATH, safeNextPath } from './next-path'

export {
  emailSchema,
  loginSchema,
  passwordSchema,
  requestVerificationCodeSchema,
  resetPasswordSchema,
  signupSchema,
  verificationCodeSchema,
} from './schemas'
export type {
  LoginInput,
  RequestVerificationCodeInput,
  ResetPasswordInput,
  SignupInput,
} from './schemas'

export {
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_CODE_TTL_MS,
} from './verification-code'
export type { VerificationPurpose } from './verification-code'

export { createArithmeticChallenge, renderChallengeSvg } from './human-check'
export type { ArithmeticChallenge } from './human-check'

export { authenticate, registerAccount, resetPassword } from './account-service'
export type { RequestFingerprint } from './account-service'

export {
  consumeVerificationCodeFor,
  requestVerificationCode,
} from './verification-service'

export { issueChallenge, passesHumanCheck } from './human-check-service'
export type { IssuedChallenge } from './human-check-service'

export {
  AUTH_FAILURE_MESSAGE,
  AUTH_FAILURE_STATUS,
  VERIFICATION_CODE_SENT_MESSAGE,
  authFailure,
  isAuthFailure,
} from './errors'
export type { AuthFailure, AuthFailureCode } from './errors'

export { authFailureResponse, readJsonBody, requestFingerprint } from './http'

export { isMailChannelConfigured } from './mailer'
