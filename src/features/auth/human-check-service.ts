import 'server-only'
import {
  createArithmeticChallenge,
  issueHumanCheckToken,
  renderChallengeSvg,
  verifyHumanCheck,
} from './human-check'
import { authSigningKey } from './signing-key'

/**
 * 人机验证的 IO 边界：把派生密钥与当前时间注入到 `human-check.ts` 的纯函数里。
 * 挑战不落库——答案只以带密钥摘要存在于客户端持有的 token 中（§1.6 第 3 项）。
 */
export interface IssuedChallenge {
  token: string
  question: string
  svg: string
}

export function issueChallenge(now: Date = new Date()): IssuedChallenge {
  const challenge = createArithmeticChallenge()
  return {
    token: issueHumanCheckToken({
      answer: challenge.answer,
      issuedAt: now,
      key: authSigningKey('humanCheck'),
    }),
    question: challenge.question,
    svg: renderChallengeSvg(challenge.question),
  }
}

/**
 * 校验表单里的三项人机验证。
 *
 * 只回布尔：失败原因（蜜罐 / 太快 / 过期 / 答错）落服务端日志用于观察攻击形态，
 * **不回给客户端**——告诉攻击者「是哪一项失败」等于帮他调试（§3.4）。
 */
export function passesHumanCheck(
  input: { humanCheckToken: string; humanCheckAnswer: string; contactReference?: string },
  now: Date = new Date(),
): boolean {
  const result = verifyHumanCheck({
    token: input.humanCheckToken,
    answer: input.humanCheckAnswer,
    honeypot: input.contactReference,
    now,
    key: authSigningKey('humanCheck'),
  })
  if (!result.ok) {
    console.warn('[auth] 人机验证未通过', { reason: result.reason })
  }
  return result.ok
}
