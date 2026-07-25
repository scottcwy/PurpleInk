import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { errorMessage } from "../server/src/lib/error-message";

describe("worker error hygiene", () => {
  it("errorMessage keeps the message and drops the stack trace", () => {
    const error = new Error("boom");
    expect(errorMessage(error)).toBe("boom");
    expect(errorMessage(error)).not.toContain("at ");
    expect(errorMessage("plain failure")).toBe("plain failure");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("job runner does not persist stack traces into the public job error", async () => {
    const source = await readFile("server/src/server/job-runner.ts", "utf8");
    // 对外 error 字段只走 errorMessage；完整栈允许进 logger。
    expect(source).not.toMatch(/error:\s*String\(err\?\.stack/);
    expect(source).toMatch(/error:\s*errorMessage\(err\)/);
  });

  it("worker http api does not echo raw internal errors in 500 responses", async () => {
    const source = await readFile("server/src/server/api.ts", "utf8");
    // 500 响应体不得直接内插 String(err)（内部路径/栈会外泄）；细节走 logger。
    expect(source).not.toMatch(/sendJson\(res,\s*500,\s*\{\s*error:\s*String\(err\)/);
  });
});
