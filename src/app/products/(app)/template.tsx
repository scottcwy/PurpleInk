'use client'

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { fadeInUp } from '@/lib/motion/variants'

/**
 * 切换 (app) 下任意路由时，仅右侧内容做轻微上浮淡入进入；
 * 侧栏在共享 layout 中常驻，不随 template 重挂，视觉上“仅右侧变”。
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      {children}
    </motion.div>
  )
}
