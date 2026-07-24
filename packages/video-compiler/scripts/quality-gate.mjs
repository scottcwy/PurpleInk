#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const hyperframesPackagePath = require.resolve("hyperframes/package.json");
const hyperframesPackage = require(hyperframesPackagePath);
const hyperframesCli = resolve(dirname(hyperframesPackagePath), hyperframesPackage.bin.hyperframes);

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`)));
  });
}

const bundleRoot = resolve(process.argv[2]);
const reportPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
const renderOutputDirectory = process.argv[4] ? resolve(process.argv[4]) : undefined;
const manifest = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
const report = { schemaVersion: "video-quality-report/v1", bundleHash: manifest.bundleHash, variants: {} };
const temp = await mkdtemp(join(tmpdir(), "purpleink-quality-"));
try {
  for (const variant of manifest.variants) {
    const project = join(bundleRoot, "variants", variant.id);
    const linted = await run(process.execPath, [hyperframesCli, "lint", project, "--json"], bundleRoot);
    const lint = JSON.parse(linted.stdout);
    if (!lint.ok || lint.errorCount > 0 || lint.warningCount > 0) throw new Error(`${variant.id} Hyperframes lint reported findings`);
    const validated = await run(process.execPath, [hyperframesCli, "validate", project, "--json"], bundleRoot);
    const validation = JSON.parse(validated.stdout);
    if (!validation.ok || validation.contrastFailures > 0 || validation.errors?.length || validation.warnings?.length) throw new Error(`${variant.id} Hyperframes validation reported quality failures`);
    const inspected = await run(process.execPath, [hyperframesCli, "inspect", project, "--json", "--samples", "9"], bundleRoot);
    const inspection = JSON.parse(inspected.stdout);
    if (!inspection.ok || inspection.errorCount > 0 || inspection.warningCount > 0) throw new Error(`${variant.id} Hyperframes inspect reported layout findings`);
    const renderPath = join(temp, `${variant.id}.mp4`);
    await run(process.execPath, [hyperframesCli, "render", project, "--output", renderPath, "--fps", String(variant.fps), "--quality", "draft", "--strict"], bundleRoot);
    if (renderOutputDirectory) {
      await mkdir(renderOutputDirectory, { recursive: true });
      await copyFile(renderPath, join(renderOutputDirectory, `${variant.id}.mp4`));
    }
    const probed = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", renderPath], bundleRoot);
    const probe = JSON.parse(probed.stdout); const stream = probe.streams?.[0]; const duration = Number(probe.format?.duration);
    if (stream?.width !== variant.width || stream?.height !== variant.height || Math.abs(duration * 1000 - manifest.durationMs) > 100) throw new Error(`${variant.id} media probe does not match manifest dimensions or duration`);
    const sampleAt = (manifest.durationMs / 2000).toFixed(3);
    const signal = await run("ffmpeg", ["-hide_banner", "-loglevel", "info", "-ss", sampleAt, "-i", renderPath, "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"], bundleRoot);
    const output = `${signal.stdout}\n${signal.stderr}`;
    const ymin = Number(output.match(/lavfi\.signalstats\.YMIN=(\d+)/)?.[1]);
    const ymax = Number(output.match(/lavfi\.signalstats\.YMAX=(\d+)/)?.[1]);
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymax - ymin < 12) throw new Error(`${variant.id} sampled frame is blank or unmeasurable (YMIN=${ymin}, YMAX=${ymax})`);
    report.variants[variant.id] = { lint: "passed", validate: "passed", contrastFailures: 0, inspect: inspection, mediaProbe: { width: stream.width, height: stream.height, durationMs: Math.round(duration * 1000), frameRate: stream.r_frame_rate }, sampledFrame: { atMs: manifest.durationMs / 2, ymin, ymax, nonBlank: true } };
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) await writeFile(reportPath, serialized);
  process.stdout.write(serialized);
} catch (error) {
  process.stderr.write(`quality gate failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
