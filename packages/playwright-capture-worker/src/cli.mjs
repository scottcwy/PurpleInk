import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PlaywrightBrowserAdapter } from "./browser-adapter.mjs";
import { CaptureControlPlaneClient } from "./control-plane-client.mjs";
import { publishEvidenceManifest } from "./uploader.mjs";

const [jobPath, outputPath] = process.argv.slice(2);
if (!jobPath || !outputPath) {
  process.stderr.write("usage: cli.mjs <job.json> <output-dir>\n");
  process.exit(64);
}

try {
  const job = JSON.parse(await readFile(resolve(jobPath), "utf8"));
  const output = resolve(outputPath);
  if (job.controlPlaneUrl && job.workloadToken) {
    const manifest = await new CaptureControlPlaneClient({
      baseUrl: job.controlPlaneUrl,
      workloadToken: job.workloadToken,
      workspaceId: job.workspaceId,
      jobId: job.jobId,
      attempt: job.attempt,
    }).run({ outputDir: output, adapter: new PlaywrightBrowserAdapter() });
    await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.PURPLEINK_LOCAL_CAPTURE !== "1") {
    throw new Error("CONTROL_PLANE_REQUIRED: production capture requires a scoped control-plane bootstrap");
  }
  const manifest = await new PlaywrightBrowserAdapter().run(job, output);
  if (job.signUploadsUrl || job.workloadToken) {
    await publishEvidenceManifest({
      manifest,
      outputDir: output,
      signUploadsUrl: job.signUploadsUrl,
      workloadToken: job.workloadToken,
    });
  }
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
