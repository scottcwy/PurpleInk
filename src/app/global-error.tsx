'use client'

import { CircleX, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { buttonClassName } from '@/components/ui/button'
import './globals.css'

/**
 * 根级兜底错误边界。root layout 已经失效，因此本文件自带 `html`/`body`，
 * 自行 import 样式，且不依赖 Providers、字体加载器或主题初始化脚本。
 *
 * 主题脚本不会运行，页面按 `:root` 默认的 Porcelain Light 渲染。
 * 与段级错误页一致：只给类别与 digest，不回显原始错误内容。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main
          role="alert"
          className="ds-app-gradient flex min-h-screen w-full flex-col items-center justify-center gap-4 p-6 text-center text-ds-text"
        >
          <CircleX aria-hidden className="size-12 text-ds-text-muted" />
          <h1 className="text-[22px] font-semibold">应用无法继续运行</h1>
          <p className="max-w-80 text-[13px] text-ds-text-muted">
            发生了一个未处理的错误。请重试，或刷新页面重新进入。
          </p>
          {error.digest ? (
            <p className="font-mono text-[11px] text-ds-text-muted">
              <span className="sr-only">错误参考号：</span>
              {error.digest}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/" className={buttonClassName({ variant: 'gray' })}>
              返回首页
            </Link>
            <button
              type="button"
              onClick={reset}
              className={buttonClassName({ variant: 'tinted' })}
            >
              <RefreshCw aria-hidden className="size-4 shrink-0" />
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
