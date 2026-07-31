'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Toast, type ToastVariant } from '@/components/ui/toast'
import { DEFAULT_TOAST_DURATION } from '@/components/ui/toast-store'
import { TRANSITION_BASE, TRANSITION_EXIT } from '@/lib/motion/tokens'

export interface FormFeedbackProps {
  variant: ToastVariant
  title: string
  body?: string
  /** 退场动画播完后回调，父级借此清除对应 state（error / notice）。 */
  onDismiss?: () => void
}

/** info / success 是操作回执，读完即弃；error / warning 常驻等用户处理。 */
const AUTO_DISMISS_VARIANTS: readonly ToastVariant[] = ['info', 'success']

/**
 * 认证表单的行内反馈条：组合 SSOT `<Toast>`，补进出场动画与自动消失策略。
 *
 * 刻意不走全局 toast store——表单错误必须留在表单上下文里，
 * 紧挨着出错的字段与提交按钮，而不是飘在视口角落。
 * 动效对应规范 §3 意图 10（Toast 进 / 出）的行内简化版：
 * 行内元素幅面小，进场用 tween 而非 spring；退出按 §5.3 禁 spring。
 */
export function FormFeedback({ variant, title, body, onDismiss }: FormFeedbackProps) {
  // 以内容为键记录「已关闭」：内容一变键就不再相等，自动回到展示态并重置计时，
  // 无需在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  const contentKey = `${variant}\u0000${title}\u0000${body ?? ''}`
  const [dismissedKey, setDismissedKey] = useState<string>()
  const open = dismissedKey !== contentKey

  useEffect(() => {
    if (!AUTO_DISMISS_VARIANTS.includes(variant)) return
    const timer = setTimeout(() => setDismissedKey(contentKey), DEFAULT_TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [variant, contentKey])

  return (
    <div aria-live="polite">
      <AnimatePresence onExitComplete={onDismiss}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: TRANSITION_BASE }}
            exit={{ opacity: 0, y: -4, transition: TRANSITION_EXIT }}
          >
            <Toast
              variant={variant}
              title={title}
              body={body}
              onClose={() => setDismissedKey(contentKey)}
              className="w-full"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
