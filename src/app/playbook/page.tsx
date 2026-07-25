import Link from 'next/link'
import {
  PENCIL_COMPONENT_FAMILY_COUNT,
  PENCIL_CONSOLIDATION_NOTE,
  PENCIL_REUSABLE_SYMBOL_COUNT,
} from './registry'

const CATEGORIES = [
  { id: 'foundations', title: 'Foundations', desc: '设计 token：色板 / 字体 / 圆角 / 间距' },
  { id: 'ui', title: 'UI 组件', desc: '从 canvas.pen 移植的 27 个组件族' },
  { id: 'icons', title: 'Icons', desc: 'Pencil A4 · Lucide 白名单' },
] as const

export default function PlaybookIndexPage() {
  return (
    <main className="mx-auto max-w-4xl p-8 text-label">
      <h1 className="text-2xl font-bold">组件手册 · Playbook</h1>
      <p className="mt-2 text-sm text-label-secondary">
        单一真源（SSOT）：canvas.pen 共 {PENCIL_REUSABLE_SYMBOL_COUNT} 个 reusable
        symbols，登记为 {PENCIL_COMPONENT_FAMILY_COUNT} 个 UI 组件族。
      </p>
      <p className="mt-1 text-xs text-label-tertiary">{PENCIL_CONSOLIDATION_NOTE}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {CATEGORIES.map((category) => (
          <Link
            key={category.id}
            href={`/playbook/${category.id}`}
            className="rounded-lg border border-separator bg-surface p-4 transition-colors hover:bg-fill"
          >
            <div className="font-semibold">{category.title}</div>
            <div className="mt-1 text-sm text-label-secondary">{category.desc}</div>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Link href="/" className="text-sm text-label-secondary underline">
          返回首页
        </Link>
      </div>
    </main>
  )
}
