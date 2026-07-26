'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AuthRequestError,
  fetchHumanCheckChallenge,
  requestVerificationCode,
  type HumanCheckChallenge,
} from './auth-api'

/** 默认重发冷却，与 `throttle.ts` 的「同邮箱 3 / 10 分钟」留出余量。 */
const DEFAULT_COOLDOWN_SECONDS = 60

export interface VerificationCodeController {
  challenge: HumanCheckChallenge | null
  challengeLoading: boolean
  answer: string
  setAnswer: (value: string) => void
  honeypot: string
  setHoneypot: (value: string) => void
  refreshChallenge: () => void
  cooldownSeconds: number
  requesting: boolean
  sent: boolean
  notice?: string
  error?: string
  requestCode: (email: string) => Promise<void>
  clearFeedback: () => void
}

/**
 * 注册 / 重置两条流程共用的「取挑战 → 填答案 → 要验证码 → 冷却」控制器。
 *
 * 冷却只在**签发成功或收到 429** 后启动：其他失败（人机验证没过、邮箱格式错）
 * 不该罚用户等待。429 直接采用服务端 `Retry-After`，让按钮状态与服务端限流
 * 是同一份真值，不会出现按钮可点但必然被拒的错位。
 */
export function useVerificationCode(
  purpose: 'signup' | 'password_reset',
): VerificationCodeController {
  const [challenge, setChallenge] = useState<HumanCheckChallenge | null>(null)
  const [challengeLoading, setChallengeLoading] = useState(true)
  const [answer, setAnswer] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [sent, setSent] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadChallenge = useCallback(async () => {
    setChallengeLoading(true)
    try {
      const next = await fetchHumanCheckChallenge()
      if (!mounted.current) return
      setChallenge(next)
      setAnswer('')
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause))
    } finally {
      if (mounted.current) setChallengeLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadChallenge()
  }, [loadChallenge])

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setTimeout(() => setCooldownSeconds((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldownSeconds])

  const requestCode = useCallback(
    async (email: string) => {
      if (!challenge) return
      setRequesting(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const result = await requestVerificationCode(purpose, {
          email,
          humanCheckToken: challenge.token,
          humanCheckAnswer: answer,
          contactReference: honeypot,
        })
        if (!mounted.current) return
        setSent(true)
        setNotice(result.message)
        setCooldownSeconds(DEFAULT_COOLDOWN_SECONDS)
      } catch (cause) {
        if (!mounted.current) return
        setError(messageOf(cause))
        if (cause instanceof AuthRequestError && cause.retryAfterSeconds) {
          setCooldownSeconds(cause.retryAfterSeconds)
        } else {
          // 人机验证一次性消费：失败后必须换一道题，否则用户会重复提交同一个
          // 已被服务端记过账的 token。
          void loadChallenge()
        }
      } finally {
        if (mounted.current) setRequesting(false)
      }
    },
    [answer, challenge, honeypot, loadChallenge, purpose],
  )

  return {
    challenge,
    challengeLoading,
    answer,
    setAnswer,
    honeypot,
    setHoneypot,
    refreshChallenge: () => void loadChallenge(),
    cooldownSeconds,
    requesting,
    sent,
    notice,
    error,
    requestCode,
    clearFeedback: () => {
      setError(undefined)
      setNotice(undefined)
    },
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '请稍后重试'
}
