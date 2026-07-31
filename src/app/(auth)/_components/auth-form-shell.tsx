'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { HONEYPOT_FIELD_NAME } from '@/features/auth/honeypot'
import { fadeInUp } from '@/lib/motion/variants'

/**
 * 右栏表单的统一外壳：标题、说明、表单槽、底部换页链接。
 *
 * 三个认证页共用同一份版式，避免复制三套布局（PLAN-002 §4.1 最后一段）。
 *
 * 入场用 `fadeInUp` 一次性淡入上浮（不加 exit：换页是整页导航，无离场动画）；
 * prefers-reduced-motion 由根布局 MotionConfig reducedMotion="user" 自动降级。
 */
export function AuthFormShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      className="mx-auto w-full max-w-[420px] py-6"
    >
      <h1 className="text-[32px] leading-none font-bold tracking-[-0.03em]">{title}</h1>
      <p className="mt-3.5 text-sm leading-6 text-ds-text-muted">{description}</p>
      <div className="mt-8">{children}</div>
      <p className="mt-6 text-sm text-ds-text-muted">{footer}</p>
    </motion.div>
  )
}

export function AuthFooterLink({ href, children }: { href: string; children: ReactNode }) {
  // py-3 -my-3：热区拉到 ≥40px，负 margin 抵消布局占位，视觉尺寸不变。
  return (
    <Link
      href={href}
      className="focus-ring -my-3 ml-2 rounded-sm py-3 font-semibold text-ds-blue underline underline-offset-4"
    >
      {children}
    </Link>
  )
}

/**
 * 蜜罐输入（PLAN-002 §1.6 第 1 项）。
 *
 * 对真实用户不可见也不可聚焦：`aria-hidden` + `tabIndex={-1}` + 视觉移出。
 * 刻意**不用 `display:none`**——部分自动填充脚本会跳过 `display:none` 的字段，
 * 反而降低命中率。
 */
export function HoneypotField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor={HONEYPOT_FIELD_NAME}>请勿填写</label>
      <input
        id={HONEYPOT_FIELD_NAME}
        name={HONEYPOT_FIELD_NAME}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
