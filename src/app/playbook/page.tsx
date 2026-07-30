import Link from "next/link";
import {
  PENCIL_COMPONENT_FAMILY_COUNT,
  PENCIL_CONSOLIDATION_NOTE,
  PENCIL_REUSABLE_SYMBOL_COUNT,
  UI_COMPONENT_FAMILY_COUNT,
} from "./registry";
import { MOTION_INTENT_COUNT } from "./motion/motion-intents";

const CATEGORIES = [
  {
    id: "foundations",
    title: "Foundations",
    desc: "设计 token：色板 / 字体 / 圆角 / 动效 / 滚动条",
  },
  {
    id: "ui",
    title: "UI 组件",
    desc: `已进入应用公共边界的 ${UI_COMPONENT_FAMILY_COUNT} 个组件族`,
  },
  {
    id: "motion",
    title: "Motion",
    desc: `${MOTION_INTENT_COUNT} 条动效意图对照台（含迁移状态）`,
  },
  { id: "icons", title: "Icons", desc: "Pencil A4 · Lucide 白名单" },
] as const;

export default function PlaybookIndexPage() {
  return (
    <main className="ds-app-gradient text-ds-text min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="border-ds-border bg-ds-surface rounded-lg border p-6 backdrop-blur-xl sm:p-8">
          <p className="text-ds-text-muted font-mono text-[10px] tracking-[0.16em] uppercase">
            canvas.pen · latest inventory
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em]">
            组件手册 · Playbook
          </h1>
          <p className="text-ds-text-muted mt-3 max-w-3xl text-sm leading-6">
            单一真源（SSOT）包含 {PENCIL_REUSABLE_SYMBOL_COUNT} 个 reusable
            symbols； PurpleInk 当前公共边界已转译{" "}
            {PENCIL_COMPONENT_FAMILY_COUNT} 个组件族。
          </p>
          <p className="text-ds-text-muted mt-1 text-xs">
            {PENCIL_CONSOLIDATION_NOTE}
          </p>
        </header>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((category) => (
            <Link
              key={category.id}
              href={`/playbook/${category.id}`}
              className="border-ds-border bg-ds-surface hover:bg-ds-surface-muted rounded-lg border p-5 backdrop-blur-xl transition-colors"
            >
              <div className="font-semibold">{category.title}</div>
              <div className="text-ds-text-muted mt-2 text-sm leading-5">
                {category.desc}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-6">
          <Link href="/" className="text-ds-text-muted text-sm underline">
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
