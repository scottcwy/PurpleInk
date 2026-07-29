import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** 从 worker 的 JobPhase 联合类型源码提取全部阶段（单一真源）。 */
async function readWorkerPhases(): Promise<string[]> {
  const source = await readFile("server/src/server/job-store.ts", "utf8");
  const union = /export type JobPhase =([^;]*?)\n\nexport interface/.exec(source);
  if (!union) throw new Error("无法在 job-store.ts 中定位 JobPhase 联合类型");
  const phases = [...union[1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
  if (phases.length === 0) throw new Error("JobPhase 联合类型为空");
  return phases;
}

/** 收集 worker 运行时实际上报的 onPhase 字面量。 */
async function readEmittedPhases(): Promise<string[]> {
  const sources = await Promise.all(
    [
      "server/src/compose/run-pipeline.ts",
      "server/src/tts/orchestrate.ts",
      "server/src/server/job-runner.ts",
    ].map((path) => readFile(path, "utf8")),
  );
  const emitted = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/(?:onPhase\?*\(|phase:\s*)"([a-z]+)"/g)) {
      emitted.add(match[1]!);
    }
  }
  return [...emitted];
}

/** 从 web 客户端的 JobPhase 联合类型源码提取全部阶段。 */
async function readWebPhases(): Promise<string[]> {
  const source = await readFile("src/lib/api.ts", "utf8");
  const union = /export type JobPhase =([^;]*);/.exec(source);
  if (!union) throw new Error("无法在 src/lib/api.ts 中定位 JobPhase 联合类型");
  return [...union[1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
}

describe("worker phase contract", () => {
  it("keeps every runtime-emitted phase inside the worker JobPhase type", async () => {
    const [workerPhases, emitted] = await Promise.all([
      readWorkerPhases(),
      readEmittedPhases(),
    ]);
    for (const phase of emitted) {
      expect(workerPhases, `worker 上报的 "${phase}" 未在 JobPhase 类型登记`).toContain(phase);
    }
  });

  it("keeps the web JobPhase type identical to the worker JobPhase type", async () => {
    const [workerPhases, webPhases] = await Promise.all([
      readWorkerPhases(),
      readWebPhases(),
    ]);
    expect(webPhases.slice().sort()).toEqual(workerPhases.slice().sort());
  });

  it("keeps the marketing composer on the project workflow boundary", async () => {
    const composerSource = await readFile(
      "src/components/marketing/launch-composer.tsx",
      "utf8",
    );
    expect(composerSource).toContain("@/features/projects/project-create-client");
    expect(composerSource).toContain("productCanvasHref");
    expect(composerSource).not.toContain("@/lib/api");
    expect(composerSource).not.toContain("PHASE_BAND");
    expect(composerSource).not.toContain("downloadVideo");
    expect(composerSource).not.toContain("/api/engine/");
  });
});
