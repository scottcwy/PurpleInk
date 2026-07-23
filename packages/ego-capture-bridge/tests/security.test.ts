import { describe, expect, it } from "vitest";
import {
  assertNavigationAllowed,
  assertSafeEvidencePayload,
  sanitizeDomSummary,
} from "../src/index.js";

describe("capture boundary security", () => {
  it.each([
    "file:///etc/passwd",
    "http://127.0.0.1/admin",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1",
    "chrome://settings",
  ])("blocks unsafe navigation to %s", async (url) => {
    await expect(
      assertNavigationAllowed(url, ["https://app.example.com"]),
    ).rejects.toThrow(/blocked|allowlist/i);
  });

  it("blocks DNS names that resolve to private addresses", async () => {
    await expect(
      assertNavigationAllowed(
        "https://rebind.example.com",
        ["https://rebind.example.com"],
        async () => ["10.0.0.7"],
      ),
    ).rejects.toThrow(/private/i);
  });

  it("accepts an HTTPS URL on the exact origin allowlist", async () => {
    await expect(
      assertNavigationAllowed(
        "https://app.example.com/settings",
        ["https://app.example.com"],
        async () => ["203.0.113.5"],
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    { cookie: "session=secret" },
    { password: "hunter2" },
    { accessToken: "secret" },
    { localStorage: { key: "value" } },
    { profile: { email: "person@example.com" } },
  ])("rejects forbidden evidence fields", (payload) => {
    expect(() => assertSafeEvidencePayload(payload)).toThrow(/sensitive/i);
  });

  it("sanitizes DOM summaries without input values or sensitive attributes", () => {
    expect(
      sanitizeDomSummary([
        {
          tag: "input",
          role: "textbox",
          text: "Email",
          value: "person@example.com",
          attributes: { type: "email", authorization: "Bearer secret" },
        },
      ]),
    ).toEqual([{ tag: "input", role: "textbox", text: "Email" }]);
  });
});
