import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBundle } from "@purpleink/video-compiler";
import { RunnerContractError } from "./runner.mjs";

const qualityScript = fileURLToPath(new URL("../../video-compiler/scripts/quality-gate.mjs", import.meta.url));

function executeQualityGate(bundleRoot, reportPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [qualityScript, bundleRoot, reportPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Hyperframes quality gate failed (${code})\n${stdout}\n${stderr}`)));
  });
}

async function defaultRun(bundleRoot, reportPath) {
  await executeQualityGate(bundleRoot, reportPath);
  return JSON.parse(await readFile(reportPath, "utf8"));
}

export async function hyperframesQualityGate({ bundle }, dependencies = {}) {
  const directory = await mkdtemp(join(tmpdir(), "purpleink-runner-quality-"));
  const reportPath = join(directory, "quality-report.json");
  try {
    await writeBundle(bundle, directory);
    const report = await (dependencies.run ?? defaultRun)(directory, reportPath);
    if (report.bundleHash !== bundle.bundleHash) {
      throw new RunnerContractError(["Hyperframes quality report bundle hash mismatch"]);
    }
    if (report.variants?.landscape?.status === "failed") {
      throw new RunnerContractError(["landscape Hyperframes quality gates failed"]);
    }
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
