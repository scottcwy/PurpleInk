import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * 锁定「唯一环境模板」契约：Next 与 worker 共用根 `.env.example` /
 * `.env.local`，不再存在 server/.env（example）或 config/tts.env.example。
 *
 * 合并背景：历史上 Next 与 worker 各有独立 env 文件（server/.env.example 与
 * 根 .env.example 各自为政），本测试的旧断言强制两者隔离。统一为一个文件后，
 * 本测试反转：根模板必须包含**全部**进程消费的变量（含 worker 的 STEP_*、
 * IMAP_*、TTS_*、BROWSER_DRIVER、PORT 等），secret 类变量值必须留空。
 *
 * 移除的旧断言（已随合并反转）：
 *   - "drops Next-side unconsumed variables that belong to server/.env.example"：
 *     STEP_API_KEY / LISTENHUB_API_KEY / IMAP_PASSWORD / SIGNUP_PASSWORD /
 *     BROWSER_DRIVER / PORT 现在必须出现在根模板（worker 消费）。
 *   - "keeps the Next-side mail channel separate from the worker IMAP variables"：
 *     IMAP_HOST / IMAP_USER 已并入根模板；仅 SMTP_*（server 代码零消费的
 *     死变量）仍不得出现。
 */

const SENSITIVE = [
  "CVC_CREDENTIAL_MASTER_KEY",
  // bootstrap 用的旧变量名（写入 DB 加密存储，运行时不读 env）
  "GEMINI_API_KEY",
  "STEPFUN_API_KEY",
  // 三家内置托管服务的 server-only 平台凭据
  "CVC_MANAGED_STEPFUN_API_KEY",
  "CVC_MANAGED_MIMO_API_KEY",
  "CVC_MANAGED_GEMINI_API_KEY",
  // Next → worker 内部路由鉴权（两端必须一致）
  "BACKEND_ORIGIN",
  "PURPLEINK_ENGINE_INTERNAL_KEY",
  // 认证验证码的出站 SMTP 通道（src/features/auth/mailer.ts 消费）
  "CVC_MAIL_SMTP_HOST",
  "CVC_MAIL_SMTP_PORT",
  "CVC_MAIL_SMTP_USER",
  "CVC_MAIL_SMTP_PASS",
  "CVC_MAIL_FROM_ADDRESS",
  "CVC_MAIL_FROM_NAME",
  // worker 侧（采集 agent / TTS）
  "STEP_API_KEY",
  "LISTENHUB_API_KEY",
  "IMAP_USER",
  "IMAP_PASSWORD",
  "SIGNUP_PASSWORD",
];

/** worker 侧非敏感默认值变量：模板中带默认值即可（不必为空）。 */
const WORKER_DEFAULTS: Array<[string, RegExp]> = [
  ["STEP_BASE_URL", /^STEP_BASE_URL=https:\/\/api\.stepfun\.com\/v1$/m],
  ["STEP_MODEL", /^STEP_MODEL=step-explore$/m],
  ["STEP_VISION_MODEL", /^STEP_VISION_MODEL=step-3\.7-flash$/m],
  ["BROWSER_DRIVER", /^BROWSER_DRIVER=playwright$/m],
  ["PORT", /^PORT=$/m],
  ["TTS_PROVIDER", /^TTS_PROVIDER=listenhub-flowspeech$/m],
  ["IMAP_HOST", /^IMAP_HOST=imap\.qq\.com$/m],
  ["MIMO_TTS_VOICE", /^MIMO_TTS_VOICE=mimo_default$/m],
];

async function rootExample(): Promise<string> {
  return readFile(".env.example", "utf8");
}

describe("single environment file contract", () => {
  it("keeps all sensitive example variables present but value-free", async () => {
    const root = await rootExample();

    for (const name of SENSITIVE) {
      expect(root).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });

  it("contains worker-side defaulted variables (merged from server/.env.example)", async () => {
    const root = await rootExample();

    for (const [name, pattern] of WORKER_DEFAULTS) {
      expect(root, `worker 变量 ${name} 应出现在唯一模板`).toMatch(pattern);
    }
  });

  it("drops the worker-side dead variables that no code consumes", async () => {
    const root = await rootExample();

    // server/.env.example 里的 SMTP_* 在 server/src 与 server/scripts 零消费
    // （发信通道是 Next 侧的 CVC_MAIL_SMTP_*），合并时不迁移。
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_NAME"]) {
      expect(root).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("no longer ships a separate server env template", async () => {
    await expect(access("server/.env.example")).rejects.toThrow();
    await expect(access("config/tts.env.example")).rejects.toThrow();
  });

  it("does not make ordinary web configuration parse TTS credentials", async () => {
    const webConfig = await readFile("src/lib/site-config.ts", "utf8");

    expect(webConfig).not.toMatch(/(?:getTtsEnv|tts\/config)/);
  });
});
