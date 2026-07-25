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
    <main className="mx-auto grid w-full max-w-6xl gap-8 p-5 sm:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:py-16">
      <section className="border-ds-border bg-ds-surface rounded-lg border p-6 backdrop-blur-xl">
        <p className="text-ds-text-muted font-mono text-[10px] tracking-[0.16em] uppercase">
          Workspace access
        </p>
        <h1 className="mt-3 text-4xl leading-none font-bold tracking-[-0.04em]">
          {isLogin ? "登录 PurpleInk" : "创建 Workspace"}
        </h1>
        <p className="text-ds-text-muted mt-4 max-w-lg text-sm leading-6">
          {isLogin
            ? "Stage B 将在这里校验会话与 Workspace 成员关系。"
            : "Stage B 将在这里创建 User、Workspace 与成员关系，不会自动虚构 Product 或 Release。"}
        </p>
        <form
          className="mt-8 space-y-4"
          aria-label={isLogin ? "登录表单外观" : "注册表单外观"}
        >
          {FIELDS[mode].map((field) => (
            <label key={field.label} className="block">
              <span className="mb-2 block text-sm font-semibold">
                {field.label}
              </span>
              <input
                disabled
                type={field.type}
                autoComplete={field.autoComplete}
                className="border-ds-border bg-ds-surface-muted h-11 w-full rounded-md border px-4 text-sm opacity-70"
              />
            </label>
          ))}
          <button
            type="button"
            disabled
            className="ds-primary-button h-11 w-full rounded-md text-sm font-semibold text-white opacity-50"
          >
            {isLogin
              ? "登录（Stage B 接线后可用）"
              : "创建 Workspace（Stage B 接线后可用）"}
          </button>
        </form>
        <p className="text-ds-text-muted mt-5 text-sm">
          {isLogin ? "还没有账号？" : "已有账号？"}
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="text-ds-blue ml-2 font-semibold underline underline-offset-4"
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
