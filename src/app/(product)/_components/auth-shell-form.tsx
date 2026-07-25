import Link from "next/link";
import { UnwiredPanel } from "./unwired-panel";

const FIELDS = {
  login: [
    { label: "工作邮箱", type: "email", autoComplete: "email" },
    { label: "密码", type: "password", autoComplete: "current-password" },
  ],
  signup: [
    { label: "用户姓名", type: "text", autoComplete: "name" },
    { label: "工作邮箱", type: "email", autoComplete: "email" },
    { label: "Workspace 名称", type: "text", autoComplete: "organization" },
    { label: "密码", type: "password", autoComplete: "new-password" },
  ],
} as const;

export function AuthShellForm({ mode }: { mode: keyof typeof FIELDS }) {
  const isLogin = mode === "login";
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8 lg:py-20">
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#a0442e] dark:text-[#ff8d74]">
          Workspace access
        </p>
        <h1 className="mt-4 font-serif text-5xl leading-none tracking-[-0.04em] sm:text-6xl">
          {isLogin ? "登录 PurpleInk" : "创建 Workspace"}
        </h1>
        <p className="mt-5 max-w-lg text-sm leading-7 text-[#655f56] dark:text-[#bbb2a6]">
          {isLogin
            ? "Stage B 将在这里校验会话与 Workspace 成员关系。"
            : "Stage B 将在这里创建 User、Workspace 与成员关系，不会自动虚构 Product 或 Release。"}
        </p>
        <form className="mt-8 space-y-4" aria-label={isLogin ? "登录表单外观" : "注册表单外观"}>
          {FIELDS[mode].map((field) => (
            <label key={field.label} className="block">
              <span className="mb-2 block text-sm font-semibold">{field.label}</span>
              <input
                disabled
                type={field.type}
                autoComplete={field.autoComplete}
                className="h-12 w-full rounded-xl border border-[#d8d0c4] bg-[#fffdf8] px-4 text-sm opacity-70 dark:border-white/10 dark:bg-white/5"
              />
            </label>
          ))}
          <button
            type="button"
            disabled
            className="h-12 w-full rounded-xl bg-[#171511] text-sm font-semibold text-[#fffaf1] opacity-45 dark:bg-[#f4ede2] dark:text-[#171511]"
          >
            {isLogin ? "登录（Stage B 接线后可用）" : "创建 Workspace（Stage B 接线后可用）"}
          </button>
        </form>
        <p className="mt-5 text-sm text-[#655f56] dark:text-[#bbb2a6]">
          {isLogin ? "还没有账号？" : "已有账号？"}
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="ml-2 font-semibold text-[#a0442e] underline underline-offset-4 dark:text-[#ff8d74]"
          >
            {isLogin ? "前往注册" : "前往登录"}
          </Link>
        </p>
      </section>
      <UnwiredPanel
        title={isLogin ? "身份认证" : "账号与 Workspace"}
        description={
          isLogin
            ? "本页目前只提供可访问的表单外观，不提交凭据，也不推断当前会话。"
            : "本页目前不创建账号、Workspace、成员关系或示例业务数据。"
        }
        sources={
          isLogin
            ? ["User", "WorkspaceMembership", "Session"]
            : ["User", "Workspace", "WorkspaceMembership"]
        }
      />
    </main>
  );
}
