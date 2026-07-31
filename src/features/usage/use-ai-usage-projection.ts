'use client'

import { useEffect, useState } from 'react'
import type {
  AiUsageProjectionV1,
  AiUsageRange,
  AiUsageView,
} from './contracts'

interface UsageProjectionState {
  projection: AiUsageProjectionV1 | null
  status: 'ready' | 'loading' | 'error'
}

export function useAiUsageProjection(
  initialProjection: AiUsageProjectionV1 | null,
  view: AiUsageView,
  range: AiUsageRange,
): UsageProjectionState {
  const [projection, setProjection] = useState(initialProjection)
  const [failedKey, setFailedKey] = useState('')
  const [loadedKey, setLoadedKey] = useState(
    initialProjection
      ? keyOf(initialProjection.view, initialProjection.range, initialProjection.timeZone)
      : '',
  )

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const requestKey = keyOf(view, range, timeZone)
    if (loadedKey === requestKey) return
    const controller = new AbortController()
    const query = new URLSearchParams({ view, range, timeZone })
    void fetch(`/api/ai-usage?${query}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`usage projection ${response.status}`)
        return response.json() as Promise<AiUsageProjectionV1>
      })
      .then((projection) => {
        setProjection(projection)
        setFailedKey('')
        setLoadedKey(requestKey)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFailedKey(requestKey)
      })
    return () => controller.abort()
  }, [loadedKey, range, view])

  const matchesRange = projection?.view === view && projection.range === range
  return {
    projection,
    status: failedKey
      ? 'error'
      : matchesRange
        ? 'ready'
        : 'loading',
  }
}

function keyOf(view: AiUsageView, range: AiUsageRange, timeZone: string): string {
  return `${view}:${range}:${timeZone}`
}
