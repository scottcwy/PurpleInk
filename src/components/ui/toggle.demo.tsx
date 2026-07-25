'use client'

import { useState } from 'react'
import { Toggle } from './toggle'

export function ToggleDemo() {
  const [checked, setChecked] = useState(true)
  return <Toggle checked={checked} onCheckedChange={setChecked} />
}
