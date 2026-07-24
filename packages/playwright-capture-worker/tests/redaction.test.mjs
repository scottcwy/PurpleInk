import { describe, expect, it } from "vitest";

import { sanitizeDomRecords } from "../src/redaction.mjs";

describe("sanitizeDomRecords", () => {
  it("removes sensitive values and requires review", () => {
    const source = [
      { tag: "p", text: "Contact owner@example.com" },
      { tag: "p", text: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature" },
      { tag: "p", accessibleName: "api_key=sk_live_1234567890abcdef" },
    ];

    const result = sanitizeDomRecords(source);
    const serialized = JSON.stringify(result.records);

    expect(result.redactionStatus).toBe("needs_review");
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["email", "bearer_token", "named_secret"])
    );
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).not.toContain("sk_live_1234567890abcdef");
    expect(serialized).toContain("[REDACTED]");
  });

  it("leaves non-sensitive product copy eligible for final storage", () => {
    const source = [
      { tag: "h1", text: "Golden Product" },
      { tag: "a", text: "Open dashboard", href: "/dashboard" },
    ];

    expect(sanitizeDomRecords(source)).toEqual({
      records: source,
      redactionStatus: "passed",
      findings: [],
    });
  });

  it("redacts secrets embedded in relative URL query parameters", () => {
    const result = sanitizeDomRecords([
      { tag: "a", href: "/callback?token=secret-value-123456" },
    ]);

    expect(result.redactionStatus).toBe("needs_review");
    expect(result.records[0].href).not.toContain("secret-value-123456");
  });
});
