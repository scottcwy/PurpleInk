import postgres from "postgres";
import {
  LaunchVideoRunner,
  PostgresLaunchVideoJobRepository,
  R2ObjectStore,
  hyperframesQualityGate,
} from "@purpleink/launch-video-runner";

import { getServerEnv } from "@/lib/env";
import { LaunchVideoHttpController } from "@/lib/launch-video/http";

let controller: LaunchVideoHttpController | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the LaunchVideo Runner API`);
  return value;
}

function workloadSecret(): string {
  const value = required("LAUNCH_VIDEO_WORKLOAD_TOKEN");
  if (Buffer.byteLength(value) < 32) {
    throw new Error("LAUNCH_VIDEO_WORKLOAD_TOKEN must be at least 32 bytes");
  }
  return value;
}

async function directLaunchVideo(skillInput: unknown): Promise<unknown> {
  const response = await fetch(required("LAUNCH_VIDEO_DIRECTOR_URL"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${required("LAUNCH_VIDEO_DIRECTOR_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(skillInput),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`LaunchVideo Director failed with status ${response.status}`);
  }
  const result = await response.json();
  if (!result || typeof result !== "object") {
    throw new Error("LaunchVideo Director returned an invalid plan");
  }
  return "plan" in result ? result.plan : result;
}

export function getLaunchVideoController(): LaunchVideoHttpController {
  if (!controller) {
    const endpoint = process.env.R2_ENDPOINT;
    const store = new R2ObjectStore({
      ...(endpoint
        ? { endpoint, region: process.env.R2_REGION ?? "auto" }
        : { accountId: required("R2_ACCOUNT_ID") }),
      bucket: required("R2_VIDEO_BUCKET"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    });
    const repository = new PostgresLaunchVideoJobRepository(
      postgres(getServerEnv().DATABASE_URL)
    );
    const runner = new LaunchVideoRunner({
      repository,
      objectStore: store,
      direct: directLaunchVideo,
      qualityGate: hyperframesQualityGate,
    });
    controller = new LaunchVideoHttpController({ runner, secret: workloadSecret() });
  }
  return controller;
}
