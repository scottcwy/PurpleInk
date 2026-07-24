import postgres from "postgres";
import { R2ObjectStore } from "@purpleink/r2-store";

import { PostgresCaptureControlPlane } from "@/lib/capture/control-plane";
import { getServerEnv } from "@/lib/env";

let controlPlane: PostgresCaptureControlPlane | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Capture Worker API`);
  return value;
}

export function getCaptureWorkloadToken(): string {
  const token = required("CAPTURE_WORKLOAD_TOKEN");
  if (Buffer.byteLength(token) < 32) throw new Error("CAPTURE_WORKLOAD_TOKEN must be at least 32 bytes");
  return token;
}

export function getCaptureControlPlane(): PostgresCaptureControlPlane {
  if (!controlPlane) {
    const endpoint = process.env.R2_ENDPOINT;
    const store = new R2ObjectStore({
      ...(endpoint
        ? { endpoint, region: process.env.R2_REGION ?? "auto" }
        : { accountId: required("R2_ACCOUNT_ID") }),
      bucket: required("R2_EVIDENCE_BUCKET"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    });
    controlPlane = new PostgresCaptureControlPlane(postgres(getServerEnv().DATABASE_URL), store);
  }
  return controlPlane;
}
