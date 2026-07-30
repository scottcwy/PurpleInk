import Link from 'next/link'
import { IntentBench } from './intent-bench'
import {
  MOTION_INTENT_COUNT,
  countMotionIntents,
} from './motion-intents'

export default function PlaybookMotionPage() {
  const unified = countMotionIntents('unified')
  const pending = countMotionIntents('pending')

  return (
    <main className="ds-app-gradient text-ds-text min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/playbook" className="text-ds-text-muted text-sm underline">
          ← 组件手册
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">
          Motion · 动效意图对照台
        </h1>
        <p className="text-ds-text-muted mt-2 max-w-3xl text-sm leading-6">
          按「用户在做什么」陈列，而非按参数陈列——写代码时想的是「我要做一个抽屉」，
          不是「我要找一个 220ms」。全部 {MOTION_INTENT_COUNT} 条意图与{' '}
          <code className="font-mono text-xs">
            docs/conventions/motion-interaction.md
          </code>{' '}
          §3 逐条对应；token 对照见{' '}
          <Link href="/playbook/foundations" className="underline">
            /playbook/foundations
          </Link>
          。
        </p>

        <div className="border-ds-border bg-ds-surface mt-5 rounded-lg border p-5">
          <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
            迁移状态
          </h2>
          <p className="mt-2 text-sm">
            已统一 <strong className="text-ds-green">{unified}</strong> 条 · 待迁移{' '}
            <strong className="text-ds-amber">{pending}</strong> 条
          </p>
          <p className="text-ds-text-muted mt-2 text-xs leading-5">
            状态是真实迁移进度，不是理想状态。「已统一」的标本直接复用生产参数或生产组件，
            手册所见即产品所跑；「待迁移」的标本演示的是目标参数，与生产现状不同，
            差异在每张卡片的「生产现状」栏写明。禁止把待迁移标注成已统一——
            那会让手册变成「看起来核对过了」的假象。
          </p>
          <p className="text-ds-text-muted mt-2 text-xs leading-5">
            本页同时是动效基线截图的取样面：改动效后与基线比对，可证明只改了该改的。
            开启系统「减弱动态效果」后，所有标本应静止且不丢失信息。
          </p>
        </div>

        <IntentBench />
      </div>
    </main>
  )
}
