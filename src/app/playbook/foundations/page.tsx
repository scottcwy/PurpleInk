import Link from 'next/link'

const COLORS = ['bg-gray-900', 'bg-gray-700', 'bg-gray-500', 'bg-gray-300', 'bg-gray-100']
const RADII = ['rounded-none', 'rounded-md', 'rounded-lg', 'rounded-full']

export default function PlaybookFoundationsPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/playbook" className="text-sm text-gray-600 underline">
        ← 组件手册
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Foundations · 设计 token</h1>
      <p className="mt-2 text-sm text-gray-600">
        token 单一真源为 Tailwind 主题（globals.css）；此页只读展示。
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">色板</h2>
        <div className="mt-3 flex gap-2">
          {COLORS.map((color) => (
            <div key={color} className={`h-12 w-12 rounded ${color}`} />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">字体</h2>
        <div className="mt-3 space-y-1">
          <p className="text-3xl font-bold">标题 Aa 视频</p>
          <p className="text-base">正文 Aa 视频 code-video-canvas</p>
          <p className="text-sm text-gray-600">辅助 Aa 视频</p>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">圆角</h2>
        <div className="mt-3 flex items-end gap-3">
          {RADII.map((radius) => (
            <div key={radius} className={`h-12 w-12 bg-gray-200 ${radius}`} />
          ))}
        </div>
      </section>
    </main>
  )
}
