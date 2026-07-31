'use client'

import { CircleCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'

type Feedback =
  | { variant: 'success'; title: string; body: string }
  | { variant: 'error'; title: string; body: string }

export function RedemptionForm({ canRedeem }: { canRedeem: boolean }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = code.trim()
    if (!normalized || pending || !canRedeem) return
    setPending(true)
    setFeedback(undefined)
    try {
      const response = await fetch('/api/billing/redemptions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ code: normalized }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setFeedback({
          variant: 'error',
          title: '兑换未完成',
          body: responseMessage(payload) ?? '兑换码无效或不可用',
        })
        return
      }
      setCode('')
      setFeedback({
        variant: 'success',
        title: '兑换成功',
        body: '会员与额度周期已更新。',
      })
      router.refresh()
    } catch {
      setFeedback({
        variant: 'error',
        title: '暂时无法兑换',
        body: '网络连接异常，请稍后重试。',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
        <TextField
          label="兑换码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="输入一次性兑换码"
          autoComplete="off"
          spellCheck={false}
          disabled={!canRedeem || pending}
          className="w-full flex-1"
        />
        <Button
          type="submit"
          icon={CircleCheck}
          disabled={!canRedeem || pending || !code.trim()}
          className="sm:min-w-28"
        >
          {pending ? '兑换中…' : '立即兑换'}
        </Button>
      </form>
      {!canRedeem && (
        <p className="text-xs text-ds-amber">仅工作区 Owner 可以使用兑换码。</p>
      )}
      {feedback && (
        <Toast
          variant={feedback.variant}
          title={feedback.title}
          body={feedback.body}
          className="w-full"
          onClose={() => setFeedback(undefined)}
        />
      )}
    </div>
  )
}

function responseMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const error = (value as Record<string, unknown>).error
  return typeof error === 'string' ? error : null
}
