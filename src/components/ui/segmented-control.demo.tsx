'use client'

import { useState } from 'react'
import { SegmentedControl } from './segmented-control'

export function SegmentedControlDemo() {
  const [value, setValue] = useState('shots')
  return (
    <SegmentedControl
      options={[
        { value: 'shots', label: '分镜' },
        { value: 'audio', label: '音频' },
        { value: 'export', label: '导出' },
      ]}
      value={value}
      onChange={setValue}
    />
  )
}
