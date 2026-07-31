import Image from 'next/image'

/**
 * 认证壳左半屏海报。
 *
 * `priority` + 显式 `sizes`：它是桌面端首屏最大的元素，也就是 LCP 元素。
 * `(min-width: 1024px) 50vw` 与左栏实际占比一致，让 Next 选到正确的 srcset 档位。
 *
 * 移动端的实测口径（PLAN-002 §4.2 第 3 点，不含糊表述）：父级 `<aside>` 是
 * `hidden lg:block`，节点**仍在 DOM 里**，浏览器仍会发一次请求。因为容器计算宽度
 * 为 0，`sizes` 的 `1px` 分支让它落到最小候选档，实测 12,292 B（w=384）而不是
 * 源文件 114,058 B。这里刻意不改成 `<picture media>` 手搓优化器 URL：省下的
 * 12 KB 抵不上绕过 `next/image` 后失去的响应式档位与将来格式协商。
 */
export function AuthPoster() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-ds-surface-muted">
      <Image
        src="/img/login.webp"
        alt="PurpleInk 工作区：从产品事实与演示证据生成可追溯的发布视频"
        fill
        priority
        sizes="(min-width: 1024px) 50vw, 1px"
        className="object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ds-scrim to-transparent p-10 pt-24">
        <p className="font-mono text-[10px] tracking-[0.16em] text-white/70 uppercase">
          PurpleInk workspace
        </p>
        <p className="mt-3 max-w-md text-2xl leading-9 font-semibold tracking-[-0.02em] text-white">
          把已批准的产品事实与真实演示证据，做成可追溯的发布视频。
        </p>
      </div>
    </div>
  )
}
