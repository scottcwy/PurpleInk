'use client'

import { useEffect, useState } from 'react'
import {
  isBillingUiProjection,
  type BillingUiProjection,
} from './projection-contract'

export function useBillingProjection(enabled = true): {
  projection: BillingUiProjection | undefined
  unavailable: boolean
} {
  const [projection, setProjection] = useState<BillingUiProjection>()
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void fetch('/api/billing', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('billing projection unavailable')
        const value: unknown = await response.json()
        if (!isBillingUiProjection(value)) throw new Error('billing projection invalid')
        if (active) setProjection(value)
      })
      .catch(() => {
        if (active) setUnavailable(true)
      })
    return () => {
      active = false
    }
  }, [enabled])

  return { projection, unavailable }
}
