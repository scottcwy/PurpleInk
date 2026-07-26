import 'server-only'

/**
 * 路演 / 评审用的公开体验账号提示。
 *
 * 这是**有意对外公开**的一组凭据，因此它与 AGENTS.md §7 的 secret 纪律不冲突：
 * 那条纪律禁止的是「把真正的 secret 送到客户端」。但为了让它可关、可换、
 * 且不被编译进产物，实现上仍守两条：
 *
 * 1. **不用 `NEXT_PUBLIC_*`**。`NEXT_PUBLIC_*` 在构建期就被内联进客户端 bundle，
 *    之后无法用环境变量关掉，也无法在不重新构建的情况下换账号。这里改为在
 *    Server Component 里读普通 env，再作为 props 下传——值仍会到浏览器（本来
 *    就是要给评委看的），但**开关与内容在运行期可控**。
 * 2. **默认关闭**。邮箱与口令必须同时提供才启用；任何一项缺失即返回 null，
 *    页面上不出现任何提示。生产环境不设这两个变量即彻底消失。
 *
 * 账号本身由 `scripts/setup/seed-owner-account.ts` 创建。本模块只负责「展示什么」，
 * 不负责建号、不校验账号是否真的存在——那样会让登录页在每次渲染时查库。
 */
export interface DemoAccount {
  email: string
  password: string
  note: string
}

const DEFAULT_NOTE =
  '欢迎评委参观 PurpleInk。下面是一个预置的体验账号，登录后可以直接查看已有项目、'
  + '画布与导出结果，不需要自己注册，也不需要填写任何 API Key。'

export function readDemoAccount(): DemoAccount | null {
  const email = process.env.CVC_DEMO_ACCOUNT_EMAIL?.trim()
  const password = process.env.CVC_DEMO_ACCOUNT_PASSWORD?.trim()
  if (!email || !password) return null
  return {
    email,
    password,
    note: process.env.CVC_DEMO_ACCOUNT_NOTE?.trim() || DEFAULT_NOTE,
  }
}
