import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Playwright trace redaction", () => {
  it("removes network payloads and input values while preserving screencast frames", async () => {
    const directory = await mkdtemp(join(tmpdir(), "purpleink-trace-redaction-"));
    temporaryDirectories.push(directory);
    const tracePath = join(directory, "trace.zip");
    const archive = new AdmZip();
    archive.addFile("trace.trace", Buffer.from([
      JSON.stringify({ type: "before", callId: "fill", method: "fill", params: { selector: "input", value: "top-secret-value" } }),
      JSON.stringify({ type: "log", callId: "fill", message: "owner@example.com" }),
      JSON.stringify({ type: "screencast-frame", sha1: "frame.jpeg" }),
    ].join("\n")));
    archive.addFile("trace.network", Buffer.from(JSON.stringify({
      type: "resource-snapshot",
      snapshot: {
        request: { headers: [{ name: "authorization", value: "Bearer secret-token-value" }], postData: { _sha1: "request-body" } },
        response: { content: { _sha1: "response-body" } },
      },
    })));
    archive.addFile("resources/frame.jpeg", Buffer.from("screenshot"));
    archive.addFile("resources/request-body", Buffer.from("password=secret"));
    archive.addFile("resources/response-body", Buffer.from("private response"));
    await writeFile(tracePath, archive.toBuffer());

    const module = await import("../src/trace-redaction.mjs").catch(() => ({}));
    expect(module.sanitizeTraceArchive).toBeTypeOf("function");
    await module.sanitizeTraceArchive(tracePath);

    const sanitized = new AdmZip(await readFile(tracePath));
    expect(sanitized.readAsText("trace.network")).toBe("");
    expect(sanitized.getEntry("resources/frame.jpeg")).not.toBeNull();
    expect(sanitized.getEntry("resources/request-body")).toBeNull();
    expect(sanitized.getEntry("resources/response-body")).toBeNull();
    const trace = sanitized.readAsText("trace.trace");
    expect(trace).not.toContain("top-secret-value");
    expect(trace).not.toContain("owner@example.com");
    expect(trace).toContain("[REDACTED]");
  });
});
