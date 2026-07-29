import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { resolveCredentials } from "../server/src/capture/credentials";
import { cacheSlugForUrl } from "../server/src/compose/run-pipeline";
import { verifyInternalEngineKey } from "../server/src/server/internal-auth";
import {
  createIntegratedJob,
  toIntegratedJobView,
  updateJob,
} from "../server/src/server/job-store";
import { normalizeInternalRenderRequest } from "../server/src/server/internal-render-request";
import {
  PublicUrlPolicyError,
  validatePublicUrl,
  type PublicDnsResolver,
} from "../server/src/security/public-url-policy";

const publicResolver: PublicDnsResolver = async () => [{ address: "93.184.216.34" }];

describe("worker internal integration boundary", () => {
  it("fails closed when the internal key is absent and compares either supported header", () => {
    expect(verifyInternalEngineKey({}, undefined)).toBe("unconfigured");
    expect(
      verifyInternalEngineKey({ authorization: "Bearer engine-secret" }, "engine-secret"),
    ).toBe("authorized");
    expect(
      verifyInternalEngineKey(
        { "x-purpleink-engine-key": "engine-secret" },
        "engine-secret",
      ),
    ).toBe("authorized");
    expect(
      verifyInternalEngineKey({ authorization: "Bearer wrong-secret" }, "engine-secret"),
    ).toBe("unauthorized");
  });

  it("canonicalizes a public URL and rejects credentialed, local and DNS-private targets", async () => {
    await expect(
      validatePublicUrl("HTTPS://Example.COM:443/product?mode=demo#fragment", publicResolver),
    ).resolves.toBe("https://example.com/product?mode=demo");

    await expect(
      validatePublicUrl("https://user:pass@example.com", publicResolver),
    ).rejects.toMatchObject(policyError("URL_CREDENTIALS_FORBIDDEN"));
    await expect(validatePublicUrl("http://localhost:3000", publicResolver)).rejects.toMatchObject(
      policyError("URL_HOST_FORBIDDEN"),
    );
    await expect(validatePublicUrl("http://169.254.169.254/latest", publicResolver)).rejects
      .toMatchObject(policyError("URL_ADDRESS_NOT_PUBLIC"));

    const privateResolver: PublicDnsResolver = async () => [{ address: "10.20.30.40" }];
    await expect(validatePublicUrl("https://example.com", privateResolver)).rejects.toMatchObject(
      policyError("URL_ADDRESS_NOT_PUBLIC"),
    );

    const mixedResolver: PublicDnsResolver = async () => [
      { address: "93.184.216.34" },
      { address: "127.0.0.1" },
    ];
    await expect(validatePublicUrl("https://example.com", mixedResolver)).rejects.toMatchObject(
      policyError("URL_ADDRESS_NOT_PUBLIC"),
    );
  });

  it("normalizes internal URL-only requests and rejects capture or credential overrides", async () => {
    await expect(
      normalizeInternalRenderRequest(
        {
          requestId: "project:018f",
          url: "https://Example.com/demo?q=1#section",
          duration: 24,
          quality: "standard",
        },
        publicResolver,
      ),
    ).resolves.toMatchObject({
      requestId: "project:018f",
      url: "https://example.com/demo?q=1",
      duration: 24,
      quality: "standard",
      capture: { credentialMode: "none", publicOnly: true },
    });

    await expect(
      normalizeInternalRenderRequest(
        { requestId: "project:018f", captureDir: "./capture" },
        publicResolver,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_URL_REQUIRED" });
    await expect(
      normalizeInternalRenderRequest(
        {
          requestId: "project:018f",
          url: "https://example.com",
          capture: { testEmail: "secret@example.com" },
        },
        publicResolver,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_FIELD_FORBIDDEN" });
  });

  it("reuses the same integrated job for an identical request and rejects conflicts", () => {
    const requestId = `test-${randomUUID()}`;
    const first = createIntegratedJob(
      "https://example.com/demo?q=1",
      requestId,
      "fingerprint-a",
      24,
    );
    expect(first.kind).toBe("created");
    expect(toIntegratedJobView(first.job)).toMatchObject({
      durationSec: 24,
      durationSource: "request",
    });

    const repeated = createIntegratedJob(
      "https://example.com/demo?q=1",
      requestId,
      "fingerprint-a",
    );
    expect(repeated.kind).toBe("reused");
    expect(repeated.job.id).toBe(first.job.id);

    const conflict = createIntegratedJob(
      "https://example.com/demo?q=2",
      requestId,
      "fingerprint-b",
    );
    expect(conflict.kind).toBe("conflict");
    expect(conflict.job.id).toBe(first.job.id);
  });

  it("returns an integrated DTO without query strings, raw errors, logs or local paths", () => {
    const requestId = `safe-${randomUUID()}`;
    const created = createIntegratedJob(
      "https://example.com/demo?token=do-not-return",
      requestId,
      "safe-fingerprint",
    );
    updateJob(created.job.id, {
      status: "failed",
      phase: "failed",
      error: "C:\\private\\output\\video.mp4 token=raw",
      captureDir: "C:\\private\\capture",
      projectDir: "C:\\private\\project",
      goldenVerified: false,
      goldenDetails: ["C:\\private\\golden.png mismatch"],
    });

    const dto = toIntegratedJobView(created.job);
    const serialized = JSON.stringify(dto);
    expect(dto.origin).toBe("https://example.com");
    expect(dto.goldenCheckCount).toBe(1);
    expect(dto.failure).toEqual({ code: "ENGINE_JOB_FAILED" });
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("C:\\\\private");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("logs");
    expect(serialized).not.toContain('"input"');
  });

  it("forces public/none credentials to bypass user credentials and IMAP registration", async () => {
    const previous = {
      host: process.env.IMAP_HOST,
      user: process.env.IMAP_USER,
      password: process.env.IMAP_PASSWORD,
    };
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "automation@example.com";
    process.env.IMAP_PASSWORD = "not-read";
    try {
      await expect(
        resolveCredentials({
          credentialMode: "none",
          testEmail: "user@example.com",
          testPassword: "not-read",
        }),
      ).resolves.toBeNull();
      await expect(resolveCredentials({ credentialMode: "public" })).resolves.toBeNull();
      await expect(resolveCredentials({})).resolves.toMatchObject({ mode: "auto" });
    } finally {
      restoreEnv("IMAP_HOST", previous.host);
      restoreEnv("IMAP_USER", previous.user);
      restoreEnv("IMAP_PASSWORD", previous.password);
    }
  });

  it("uses request identity plus the full canonical URL for integrated capture caches", () => {
    const first = cacheSlugForUrl("https://example.com/demo?q=one", "project:018f");
    const repeated = cacheSlugForUrl("https://example.com/demo?q=one", "project:018f");
    const changedQuery = cacheSlugForUrl("https://example.com/demo?q=two", "project:018f");
    const changedRequest = cacheSlugForUrl("https://example.com/demo?q=one", "project:0190");

    expect(first).toBe(repeated);
    expect(first).not.toBe(changedQuery);
    expect(first).not.toBe(changedRequest);
    expect(first).toMatch(/^integrated-[a-f0-9]{32}$/);
    expect(cacheSlugForUrl("https://example.com/demo?q=one")).toBe(
      cacheSlugForUrl("https://example.com/demo?q=two"),
    );
  });
});

function policyError(code: PublicUrlPolicyError["code"]): Partial<PublicUrlPolicyError> {
  return { code };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
