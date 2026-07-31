'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Play } from 'lucide-react'
import {
  DURATION,
  SPRING_SPATIAL_DEFAULT,
  SPRING_SPATIAL_FAST,
  SPRING_SPATIAL_SLOW,
} from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

/**
 * 动效 token 对照台（Foundations）。
 *
 * 时长与曲线两组刻意使用 Tailwind class（`duration-base` / `ease-emphasized`）
 * 而非 inline style：若 `@theme` 的 `--transition-duration-*` 导出缺失，
 * 这两组会静止不动，本页因此自带 token 消费路径的可视化验证。
 * 弹性组读 `src/lib/motion/tokens.ts` 的同一份参数。
 *
 * 行程用固定像素而非百分比，保证基线截图可复现。
 * 权威源：docs/conventions/motion-interaction.md §2。
 */

/** 轨道宽度与滑块行程（px）。轨道 overflow-hidden，窄屏裁切不影响判读。 */
const TRACK_WIDTH = 420
const TRAVEL = 380

const DURATION_ROWS = [
  ['fast', 'duration-fast', DURATION.fast, 'hover 换底、focus ring、图标色变'],
  ['base', 'duration-base', DURATION.base, '面板、抽屉、折叠、路由转场'],
  ['slow', 'duration-slow', DURATION.slow, '全屏遮罩、大面积强调'],
  ['narrative', 'duration-narrative', DURATION.narrative, '仅 (marketing) 段的叙事进入'],
] as const

const EASE_ROWS = [
  ['standard', 'ease-standard', '0.4, 0, 0.2, 1', '默认。绝大多数变化'],
  ['emphasized', 'ease-emphasized', '0.22, 1, 0.36, 1', '进入 / 展开，末段有落位感'],
  ['exit', 'ease-exit', '0.4, 0, 1, 1', '离场。加速冲出，不减速'],
] as const

const SPRING_ROWS = [
  ['SPATIAL_FAST', SPRING_SPATIAL_FAST, 'toggle knob、chip、按压回弹'],
  ['SPATIAL_DEFAULT', SPRING_SPATIAL_DEFAULT, '抽屉、面板、折叠、侧栏宽度'],
  ['SPATIAL_SLOW', SPRING_SPATIAL_SLOW, '全屏转场'],
] as const

const DOT = 'bg-ds-blue absolute top-1/2 left-1 size-6 rounded-sm'

function Track({
  label,
  meta,
  hint,
  children,
}: {
  label: string
  meta: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[170px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-semibold">{label}</div>
        <div className="text-ds-text-muted font-mono text-[10px]">{meta}</div>
      </div>
      <div className="min-w-0">
        <div
          className="bg-ds-surface-muted border-ds-border relative h-8 w-full overflow-hidden rounded-md border"
          style={{ maxWidth: TRACK_WIDTH }}
        >
          {children}
        </div>
        <div className="text-ds-text-muted mt-1 text-[11px]">{hint}</div>
      </div>
    </div>
  )
}

export function MotionTokensSection() {
  const [on, setOn] = useState(false)

  return (
    <section className="border-ds-border bg-ds-surface mt-5 rounded-lg border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
          动效
        </h2>
        <button
          type="button"
          onClick={() => setOn((value) => !value)}
          aria-pressed={on}
          className={cn(
            'border-ds-border bg-ds-surface hover:bg-ds-surface-muted inline-flex items-center gap-1.5',
            'rounded-md border px-2.5 py-1.5 text-xs font-medium',
            'duration-fast ease-standard transition-colors',
            'focus-visible:ring-ds-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          <Play className="size-3.5" aria-hidden />
          {on ? '收回' : '播放'}
        </button>
      </div>
      <p className="text-ds-text-muted mt-2 text-xs leading-5">
        权威源 <code className="font-mono">docs/conventions/motion-interaction.md</code> §2。
        时长与曲线两组走 Tailwind class，token 导出缺失时会静止不动。
        开启系统「减弱动态效果」后三组均应静止，且不丢失任何信息。
      </p>

      <h3 className="text-ds-text-muted mt-5 font-mono text-[10px] tracking-wide uppercase">
        时长 · 同曲线 ease-standard
      </h3>
      <div className="mt-3 space-y-3">
        {DURATION_ROWS.map(([name, durationClass, seconds, hint]) => (
          <Track key={name} label={name} meta={`${seconds * 1000}ms`} hint={hint}>
            <span
              aria-hidden
              className={cn(
                DOT,
                '-translate-y-1/2 transition-transform',
                'ease-standard',
                durationClass,
                on && 'translate-x-[380px]',
              )}
            />
          </Track>
        ))}
      </div>

      <h3 className="text-ds-text-muted mt-6 font-mono text-[10px] tracking-wide uppercase">
        曲线 · 同时长 duration-base
      </h3>
      <div className="mt-3 space-y-3">
        {EASE_ROWS.map(([name, easeClass, points, hint]) => (
          <Track key={name} label={name} meta={points} hint={hint}>
            <span
              aria-hidden
              className={cn(
                DOT,
                '-translate-y-1/2 transition-transform',
                'duration-base',
                easeClass,
                on && 'translate-x-[380px]',
              )}
            />
          </Track>
        ))}
      </div>

      <h3 className="text-ds-text-muted mt-6 font-mono text-[10px] tracking-wide uppercase">
        弹性 · spatial 三档（bounce 随面积反相关）
      </h3>
      <div className="mt-3 space-y-3">
        {SPRING_ROWS.map(([name, spring, hint]) => (
          <Track
            key={name}
            label={name}
            meta={`${spring.visualDuration}s · bounce ${spring.bounce}`}
            hint={hint}
          >
            <motion.span
              aria-hidden
              className={DOT}
              style={{ y: '-50%' }}
              animate={{ x: on ? TRAVEL : 0 }}
              transition={spring}
            />
          </Track>
        ))}
      </div>
    </section>
  )
}
