import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const image = "purpleink/playwright-capture-worker:test";
let imageDigest;
let temp;
let server;
let origin;

function productHtml() {
  return `<!doctype html><html><body>
    <main><h1>Golden Product</h1>
      <img src="https://tracking.example.invalid/pixel.png" alt="" width="1" height="1">
      <label>Project name <input aria-label="Project name"></label>
      <button id="create">Create project</button>
      <p id="created" hidden>Project created</p>
      <button id="finish">Finish</button><p id="done" hidden>Workflow complete</p>
    </main>
    <script>
      document.querySelector('#create').onclick = () => document.querySelector('#created').hidden = false;
      document.querySelector('#finish').onclick = () => document.querySelector('#done').hidden = false;
      setInterval(() => fetch('/activity', { cache: 'no-store' }), 100);
    </script>
    <section style="margin-top:2000px">Support: contact@example.com</section>
  </body></html>`;
}

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "purpleink-playwright-e2e-"));
  const cert = join(temp, "cert.pem");
  const key = join(temp, "key.pem");
  await exec("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=host.docker.internal", "-keyout", key, "-out", cert,
  ]);
  server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(productHtml());
    }
  );
  await new Promise((resolvePromise) => server.listen(0, "0.0.0.0", resolvePromise));
  origin = `https://host.docker.internal:${server.address().port}`;
  await exec("docker", ["build", "--platform=linux/amd64", "-f", "packages/playwright-capture-worker/Dockerfile", "-t", image, "."], { cwd: root, maxBuffer: 10_000_000 });
  imageDigest = (await exec("docker", ["image", "inspect", image, "--format", "{{.Id}}"])).stdout.trim();
}, 300_000);

afterAll(async () => {
  await new Promise((resolvePromise) => server?.close(resolvePromise));
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe("Linux PlaywrightCaptureWorker", () => {
  it("captures required evidence from a fresh BrowserContext", async () => {
    const input = join(temp, "input");
    const output = join(temp, "output");
    await mkdir(input);
    await mkdir(output);
    const job = {
      schemaVersion: "capture-worker-job/v1",
      kind: "discovery",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      captureSessionId: "10000000-0000-4000-8000-000000000001",
      jobId: "20000000-0000-4000-8000-000000000001",
      attempt: 1,
      runId: "30000000-0000-4000-8000-000000000001",
      flowVersionId: "40000000-0000-4000-8000-000000000001",
      imageDigest,
      ignoreHttpsErrors: true,
      flow: {
        schemaVersion: "product-flow/v1",
        productId: "50000000-0000-4000-8000-000000000001",
        startUrl: origin,
        allowedOrigins: [origin],
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        locale: "en-US",
        timezone: "UTC",
        nodes: [
          { id: "open", order: 1, title: "Open product", intent: "Show product", capabilityIds: ["cap-open"], actions: [{ id: "navigate", kind: "navigate", expectedUrl: origin, timeoutMs: 3_000, effect: "read" }], checkpoints: [{ id: "heading", kind: "visible", target: { by: "role", role: "heading", value: "Golden Product", exact: true }, timeoutMs: 5_000 }] },
          { id: "create", order: 2, title: "Create project", intent: "Create project", capabilityIds: ["cap-create"], actions: [{ id: "fill-name", kind: "fill", target: { by: "label", value: "Project name", exact: true }, value: { kind: "literal", value: "Launch" }, timeoutMs: 5_000, effect: "read" }, { id: "click-create", kind: "click", target: { by: "role", role: "button", value: "Create project", exact: true }, timeoutMs: 5_000, effect: "idempotent_write" }], checkpoints: [{ id: "created", kind: "visible", target: { by: "text", value: "Project created", exact: true }, timeoutMs: 5_000 }] },
          { id: "finish", order: 3, title: "Complete workflow", intent: "Show result", capabilityIds: ["cap-finish"], actions: [{ id: "click-finish", kind: "click", target: { by: "role", role: "button", value: "Finish", exact: true }, timeoutMs: 5_000, effect: "idempotent_write" }], checkpoints: [{ id: "done", kind: "visible", target: { by: "text", value: "Workflow complete", exact: true }, timeoutMs: 5_000 }] },
        ],
        edges: [{ from: "open", to: "create" }, { from: "create", to: "finish" }],
      },
    };
    await writeFile(join(input, "job.json"), JSON.stringify(job));

    await new Promise((resolvePromise, reject) => {
      const child = spawn("docker", [
        "run", "--rm", "--platform=linux/amd64", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "--pids-limit=256",
        "--memory=1g", "--cpus=1", "--add-host=host.docker.internal:host-gateway",
        "-e", "PURPLEINK_LOCAL_CAPTURE=1",
        "-e", "PURPLEINK_CAPTURE_ALLOW_PRIVATE_TEST_ORIGINS=1",
        "-v", `${input}:/input:ro`, "-v", `${output}:/output`, image,
        "/input/job.json", "/output",
      ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(stderr)));
    });

    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    expect(manifest.imageDigest).toBe(imageDigest);
    expect(manifest.candidateFlow).toEqual(job.flow);
    expect(manifest.entries.every((entry) => entry.redactionStatus === "passed")).toBe(true);
    for (const nodeId of ["open", "create", "finish"]) {
      expect(manifest.entries.filter((entry) => entry.nodeId === nodeId).map((entry) => entry.kind)).toEqual(
        expect.arrayContaining(["result_screenshot", "node_clip", "assertion_report", "dom_summary"])
      );
    }
    expect(manifest.entries.map((entry) => entry.kind)).toContain("trace");
    const traceEntry = manifest.entries.find((entry) => entry.kind === "trace");
    const traceArchive = new AdmZip(await readFile(join(output, traceEntry.localPath)));
    expect(traceArchive.readAsText("trace.network")).toBe("");
    expect(traceArchive.readAsText("trace.trace")).not.toContain("Launch");
    expect(traceArchive.getEntries().some((entry) => entry.entryName.startsWith("resources/"))).toBe(true);
    const clip = manifest.entries.find((entry) => entry.kind === "node_clip" && entry.nodeId === "open");
    const probe = JSON.parse((await exec("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", join(output, clip.localPath)])).stdout);
    expect(probe.streams[0]).toMatchObject({ codec_type: "video", width: 1280, height: 720 });
    expect(Number(probe.format.duration)).toBeGreaterThan(0);
    expect(Number(probe.format.duration)).toBeLessThan(5);
  }, 300_000);
});
