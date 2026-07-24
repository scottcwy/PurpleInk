import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

import { startCaptureEgressProxy } from "./egress-proxy.mjs";
import { CaptureNetworkPolicy } from "./network-policy.mjs";
import { CaptureProtocolError, captureObjectKey } from "./protocol.mjs";
import { sanitizeDomRecords } from "./redaction.mjs";
import { sanitizeTraceArchive } from "./trace-redaction.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
}

function scopedLocator(page, target) {
  if (!target) throw new CaptureProtocolError("LOCATOR_REQUIRED", "action target is required");
  let root = page;
  if (target.frame) root = scopedLocator(page, target.frame).contentFrame();
  if (target.scope) root = scopedLocator(root, target.scope);
  const exact = target.exact ?? false;
  switch (target.by) {
    case "test_id": return root.getByTestId(target.value);
    case "role": return root.getByRole(target.role ?? target.value, target.role ? { name: target.value, exact } : undefined);
    case "label": return root.getByLabel(target.value, { exact });
    case "placeholder": return root.getByPlaceholder(target.value, { exact });
    case "href": return root.locator(`a[href=${JSON.stringify(target.value)}]`);
    case "text": return root.getByText(target.value, { exact });
    case "css": return root.locator(target.value);
    default: throw new CaptureProtocolError("LOCATOR_INVALID", `unsupported locator ${target.by}`);
  }
}

function valueOf(source, fixtures) {
  if (!source) throw new CaptureProtocolError("VALUE_REQUIRED", "action value is required");
  if (source.kind === "literal") return source.value;
  if (source.kind === "fixture" && Object.hasOwn(fixtures, source.key)) return fixtures[source.key];
  if (source.kind === "local_secret") {
    throw new CaptureProtocolError("SECRET_PROVIDER_REQUIRED", "local_secret requires the production Vault provider");
  }
  if (source.kind === "user_handoff") {
    throw new CaptureProtocolError("USER_ACTION_REQUIRED", source.prompt);
  }
  throw new CaptureProtocolError("VALUE_UNAVAILABLE", "value source cannot be resolved");
}

async function executeAction(page, action, fixtures, networkPolicy, networkState, runtime) {
  if (networkState.violation) throw networkState.violation;
  const locator = action.target ? scopedLocator(page, action.target) : undefined;
  switch (action.kind) {
    case "navigate":
      await networkPolicy.assertUrl(action.expectedUrl);
      try {
        await page.goto(action.expectedUrl, { waitUntil: "domcontentloaded", timeout: action.timeoutMs });
      } catch (error) {
        throw networkState.violation ?? error;
      }
      if (networkState.violation) throw networkState.violation;
      return;
    case "click": await locator.click({ timeout: action.timeoutMs }); return;
    case "fill":
    case "select":
    case "keypress":
      if (action.value?.kind === "user_handoff") {
        if (typeof runtime?.handoff !== "function") {
          throw new CaptureProtocolError("HANDOFF_PROVIDER_REQUIRED", "user handoff requires the persisted control-plane runtime");
        }
        await runtime.handoff({ prompt: action.value.prompt, actionId: action.id, page, context: page.context() });
        return;
      }
      if (action.kind === "fill") await locator.fill(valueOf(action.value, fixtures), { timeout: action.timeoutMs });
      if (action.kind === "select") await locator.selectOption(valueOf(action.value, fixtures), { timeout: action.timeoutMs });
      if (action.kind === "keypress") await locator.press(valueOf(action.value, fixtures), { timeout: action.timeoutMs });
      return;
    case "wait_for": await locator.waitFor({ state: "visible", timeout: action.timeoutMs }); return;
    case "upload":
      throw new CaptureProtocolError("UPLOAD_DISABLED", "upload requires a signed fixture materializer");
    default: throw new CaptureProtocolError("ACTION_INVALID", `unsupported action ${action.kind}`);
  }
}

async function executeAssertion(page, assertion) {
  const locator = assertion.target ? scopedLocator(page, assertion.target) : undefined;
  switch (assertion.kind) {
    case "visible": await locator.waitFor({ state: "visible", timeout: assertion.timeoutMs }); break;
    case "hidden": await locator.waitFor({ state: "hidden", timeout: assertion.timeoutMs }); break;
    case "text_contains":
      if (!(await locator.textContent())?.includes(String(assertion.expected))) throw new Error("text assertion failed");
      break;
    case "value_equals":
      if ((await locator.inputValue()) !== String(assertion.expected)) throw new Error("value assertion failed");
      break;
    case "count_equals":
      if ((await locator.count()) !== assertion.expected) throw new Error("count assertion failed");
      break;
    case "url_matches":
      if (!new RegExp(String(assertion.expected)).test(page.url())) throw new Error("URL assertion failed");
      break;
    default: throw new CaptureProtocolError("ASSERTION_INVALID", `unsupported assertion ${assertion.kind}`);
  }
  return { id: assertion.id, kind: assertion.kind, status: "passed" };
}

async function sanitizedDomSummary(page) {
  return page.locator("body").evaluate((body) => {
    const allowed = new Set(["A", "BUTTON", "H1", "H2", "H3", "INPUT", "LABEL", "LI", "MAIN", "NAV", "P", "SECTION", "SELECT", "TEXTAREA"]);
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    return [...body.querySelectorAll("*")]
      .filter((element) => allowed.has(element.tagName))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
      })
      .slice(0, 200)
      .map((element) => {
        const record = { tag: element.tagName.toLowerCase() };
        const role = element.getAttribute("role");
        const label = element.getAttribute("aria-label");
        const testId = element.getAttribute("data-testid");
        const href = element.tagName === "A" ? element.getAttribute("href") : null;
        if (role) record.role = role;
        if (label) record.accessibleName = label.slice(0, 160);
        if (testId) record.testId = testId.slice(0, 160);
        if (href && href.startsWith("/")) record.href = href.slice(0, 240);
        if (!["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) {
          const text = element.textContent?.replace(/\s+/g, " ").trim();
          if (text) record.text = text.slice(0, 240);
        }
        return record;
      });
  });
}

async function writeAsset(outputDir, localPath, bytes) {
  const absolute = join(outputDir, localPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return absolute;
}

function entryFor(job, nodeId, kind, localPath, mimeType, bytes, redactionStatus = "passed") {
  return {
    nodeId,
    kind,
    localPath,
    r2Key: captureObjectKey({
      workspaceId: job.workspaceId,
      sessionId: job.captureSessionId,
      attempt: job.attempt,
      disposition: redactionStatus === "passed" ? "final" : "quarantine",
      nodeId,
      filename: basename(localPath),
    }),
    mimeType,
    bytes: bytes.length,
    sha256: sha256(bytes),
    redactionStatus,
  };
}

export class PlaywrightBrowserAdapter {
  async run(job, outputDir, runtime = {}) {
    await mkdir(outputDir, { recursive: true });
    const videoDir = "/tmp/purpleink-video";
    await mkdir(videoDir, { recursive: true });
    const networkPolicy = new CaptureNetworkPolicy({
      allowedOrigins: job.flow.allowedOrigins,
      allowPrivateTestOrigins: process.env.PURPLEINK_CAPTURE_ALLOW_PRIVATE_TEST_ORIGINS === "1",
    });
    const egressProxy = await startCaptureEgressProxy({ policy: networkPolicy });
    const browser = await chromium.launch({
      headless: true,
      proxy: { server: egressProxy.url, bypass: "<-loopback>" },
    });
    const context = await browser.newContext({
      viewport: { width: job.flow.viewport.width, height: job.flow.viewport.height },
      deviceScaleFactor: job.flow.viewport.deviceScaleFactor,
      locale: job.flow.locale,
      timezoneId: job.flow.timezone,
      ignoreHTTPSErrors: job.ignoreHttpsErrors === true,
      serviceWorkers: "block",
      recordVideo: { dir: videoDir, size: { width: job.flow.viewport.width, height: job.flow.viewport.height } },
    });
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "input,textarea,select,[contenteditable],[data-sensitive],[data-private]{-webkit-text-security:disc!important;color:transparent!important;text-shadow:0 0 8px #000!important}";
        document.documentElement.append(style);
      }, { once: true });
    });
    const networkState = { violation: undefined };
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        await networkPolicy.assertUrl(request.url());
        await route.continue();
      } catch (error) {
        if (request.isNavigationRequest()) networkState.violation ??= error;
        await route.abort("blockedbyclient");
      }
    });
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    const page = await context.newPage();
    const video = page.video();
    const startedAt = Date.now();
    const actionJournal = [];
    const nodeTimings = [];
    const entries = [];
    const nodeRedaction = new Map();
    let tracePath;
    let videoPath;
    try {
      for (const node of [...job.flow.nodes].sort((a, b) => a.order - b.order)) {
        const nodeStartMs = Math.max(0, Date.now() - startedAt);
        for (const action of node.actions) {
          const maxAttempts = action.effect === "read" || action.effect === "idempotent_write" ? 2 : 1;
          let lastError;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const actionStartedAt = new Date().toISOString();
            try {
              await executeAction(page, action, job.fixtures ?? {}, networkPolicy, networkState, runtime);
              actionJournal.push({ nodeId: node.id, actionId: action.id, attempt, startedAt: actionStartedAt, finishedAt: new Date().toISOString(), postcondition: "passed" });
              lastError = undefined;
              break;
            } catch (error) {
              lastError = error;
              actionJournal.push({ nodeId: node.id, actionId: action.id, attempt, startedAt: actionStartedAt, finishedAt: new Date().toISOString(), postcondition: "failed", errorCode: error.code ?? "ACTION_FAILED" });
            }
          }
          if (lastError) throw lastError;
        }
        const assertions = [];
        for (const assertion of node.checkpoints) assertions.push(await executeAssertion(page, assertion));
        await page.waitForTimeout(350);

        const rawDomSummary = await sanitizedDomSummary(page);
        const domRedaction = sanitizeDomRecords(rawDomSummary);
        const inputRedaction = sanitizeDomRecords(
          node.actions.flatMap((action) => {
            const value = action.value?.kind === "literal" ? action.value.value : undefined;
            return typeof value === "string" ? [{ value }] : [];
          })
        );
        const redactionStatus =
          domRedaction.redactionStatus === "passed" && inputRedaction.redactionStatus === "passed"
            ? "passed"
            : "needs_review";
        nodeRedaction.set(node.id, redactionStatus);
        const disposition = redactionStatus === "passed" ? "final" : "quarantine";

        const screenshotPath = `${disposition}/${node.id}/result.png`;
        const screenshot = await page.screenshot({
          type: "png",
          mask: [page.locator("input,textarea,select,[contenteditable],[data-sensitive],[data-private]")],
          maskColor: "#000000",
        });
        await writeAsset(outputDir, screenshotPath, screenshot);
        entries.push(entryFor(job, node.id, "result_screenshot", screenshotPath, "image/png", screenshot, redactionStatus));

        const assertionPath = `${disposition}/${node.id}/assertions.json`;
        const assertionBytes = jsonBytes({ schemaVersion: "assertion-report/v1", nodeId: node.id, assertions });
        await writeAsset(outputDir, assertionPath, assertionBytes);
        entries.push(entryFor(job, node.id, "assertion_report", assertionPath, "application/json", assertionBytes, redactionStatus));

        const domPath = `${disposition}/${node.id}/dom-summary.json`;
        const domBytes = jsonBytes({
          schemaVersion: "sanitized-dom-summary/v1",
          nodeId: node.id,
          redactionStatus,
          findings: domRedaction.findings,
          nodes: domRedaction.records,
        });
        await writeAsset(outputDir, domPath, domBytes);
        entries.push(entryFor(job, node.id, "dom_summary", domPath, "application/json", domBytes, redactionStatus));
        nodeTimings.push({ nodeId: node.id, startMs: nodeStartMs, endMs: Math.max(nodeStartMs + 200, Date.now() - startedAt) });
      }
      tracePath = join(outputDir, "final/run/trace.zip");
      await mkdir(dirname(tracePath), { recursive: true });
      await context.tracing.stop({ path: tracePath });
      await sanitizeTraceArchive(tracePath);
    } finally {
      await context.close();
      videoPath = await video.path();
      await browser.close();
      await egressProxy.close();
    }

    for (const timing of nodeTimings) {
      const redactionStatus = nodeRedaction.get(timing.nodeId) ?? "needs_review";
      const disposition = redactionStatus === "passed" ? "final" : "quarantine";
      const localPath = `${disposition}/${timing.nodeId}/node.mp4`;
      const absolute = join(outputDir, localPath);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (timing.startMs / 1000).toFixed(3), "-i", videoPath, "-t", ((timing.endMs - timing.startMs) / 1000).toFixed(3), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", absolute]);
      const bytes = await readFile(absolute);
      entries.push(entryFor(job, timing.nodeId, "node_clip", localPath, "video/mp4", bytes, redactionStatus));
    }
    const traceBytes = await readFile(tracePath);
    const traceRedactionStatus = [...nodeRedaction.values()].every((status) => status === "passed")
      ? "passed"
      : "needs_review";
    entries.push(entryFor(job, "run", "trace", relative(outputDir, tracePath), "application/zip", traceBytes, traceRedactionStatus));
    const actionJournalHash = sha256(jsonBytes(actionJournal));
    return {
      schemaVersion: "evidence-manifest/v1",
      workspaceId: job.workspaceId,
      captureSessionId: job.captureSessionId,
      jobId: job.jobId,
      attempt: job.attempt,
      runId: job.runId,
      flowVersionId: job.flowVersionId,
      imageDigest: job.imageDigest,
      actionJournalHash,
      entries,
      ...(job.kind === "discovery" ? { candidateFlow: structuredClone(job.flow) } : {}),
    };
  }
}
