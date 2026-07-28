import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * 锁定「.env.example 的变量名与 Next 侧代码消费的 ENV_KEYS 逐一对齐」契约。
 *
 * ISSUE-003 修订后，本测试只断言「Next 侧代码确实消费 / bootstrap 中转消费」的变量：
 *   - CVC_CREDENTIAL_MASTER_KEY：credential-envelope.ts:45 强制读取
 *   - GEMINI_API_KEY / STEPFUN_API_KEY：scripts/setup/bootstrap-credentials.ts 读取（写入
 *     DB 加密存储，运行时不读 env；详见 docs/configuration/credentials.md）
 *   - CVC_MANAGED_*：三家内置托管服务的 server-only 平台凭据
 *   - BACKEND_ORIGIN：next.config.ts:30 rewrites 直接消费（反向代理到 worker）
 *
 * 移除的旧断言（历史漂移，至本 issue 一次性纠正）：
 *   - STEP_API_KEY       —— server/.env.example 的变量，Next 侧 config.ts:64-70
 *                           ENV_KEYS 用 STEPFUN_* 前缀，零消费
 *   - LISTENHUB_API_KEY  —— server TTS 用，docs/configuration/tts.md:62 明示
 *                           「repository-level .env.example intentionally contains no TTS settings」
 *   - IMAP_PASSWORD       —— server 注册机器人用，Next 进程零消费
 *   - SIGNUP_PASSWORD     —— 同上
 *   - BROWSER_DRIVER      —— server/.env.example:20，Next 侧零消费
 *   - PORT                —— server/src/index.ts:14，Next 用 `next dev` 默认端口不读 PORT
 */
describe("global environment isolation", () => {
  it("keeps sensitive examples present but value-free", async () => {
    const rootExample = await readFile(".env.example", "utf8");

    for (const name of [
      "CVC_CREDENTIAL_MASTER_KEY",
      "GEMINI_API_KEY",
      "STEPFUN_API_KEY",
      "CVC_MANAGED_STEPFUN_API_KEY",
      "CVC_MANAGED_MIMO_API_KEY",
      "CVC_MANAGED_GEMINI_API_KEY",
      "BACKEND_ORIGIN",
      // PLAN-002 §1.5：认证验证码的出站 SMTP 通道，src/features/auth/mailer.ts 消费。
      "CVC_MAIL_SMTP_HOST",
      "CVC_MAIL_SMTP_PORT",
      "CVC_MAIL_SMTP_USER",
      "CVC_MAIL_SMTP_PASS",
      "CVC_MAIL_FROM_ADDRESS",
      "CVC_MAIL_FROM_NAME",
    ]) {
      expect(rootExample).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });

  it("keeps the Next-side mail channel separate from the worker IMAP variables", async () => {
    const rootExample = await readFile(".env.example", "utf8");

    // server/.env 的 SMTP_* / IMAP_* 属于采集 agent 的收信链路，方向与本产品
    // 发信相反，不得被 Next 侧读取（PLAN-002 §6）。
    for (const name of ["SMTP_HOST", "SMTP_PASS", "IMAP_HOST", "IMAP_USER"]) {
      expect(rootExample).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("drops Next-side unconsumed variables that belong to server/.env.example", async () => {
    const rootExample = await readFile(".env.example", "utf8");

    for (const name of [
      "STEP_API_KEY",
      "LISTENHUB_API_KEY",
      "IMAP_PASSWORD",
      "SIGNUP_PASSWORD",
      "BROWSER_DRIVER",
      "PORT",
    ]) {
      expect(rootExample).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("does not make ordinary web configuration parse TTS credentials", async () => {
    const webConfig = await readFile("src/lib/site-config.ts", "utf8");

    expect(webConfig).not.toMatch(/(?:getTtsEnv|tts\/config)/);
  });
});
