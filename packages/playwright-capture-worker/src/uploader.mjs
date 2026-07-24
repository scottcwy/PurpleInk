import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CaptureProtocolError } from "./protocol.mjs";

export async function publishEvidenceManifest({
  manifest,
  outputDir,
  signUploadsUrl,
  workloadToken,
  requestFields = {},
  fetcher = fetch,
}) {
  if (!signUploadsUrl || !workloadToken) {
    throw new CaptureProtocolError(
      "UPLOAD_AUTH_REQUIRED",
      "signUploadsUrl and workloadToken are required"
    );
  }
  const response = await fetcher(signUploadsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workloadToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...requestFields,
      workspaceId: manifest.workspaceId,
      captureSessionId: manifest.captureSessionId,
      jobId: manifest.jobId,
      attempt: manifest.attempt,
      entries: manifest.entries.map(
        ({ localPath: _localPath, ...entry }) => entry
      ),
    }),
  });
  if (!response.ok) {
    throw new CaptureProtocolError(
      "UPLOAD_SIGNING_FAILED",
      `signer returned ${response.status}`
    );
  }
  const payload = await response.json();
  if (!Array.isArray(payload.uploads) || payload.uploads.length !== manifest.entries.length) {
    throw new CaptureProtocolError(
      "UPLOAD_SIGNING_INVALID",
      "signer returned the wrong number of URLs"
    );
  }
  const signedByKey = new Map(payload.uploads.map((upload) => [upload.r2Key, upload]));
  for (const entry of manifest.entries) {
    const signed = signedByKey.get(entry.r2Key);
    if (!signed) {
      throw new CaptureProtocolError(
        "UPLOAD_SIGNING_INVALID",
        `signer omitted ${entry.r2Key}`
      );
    }
    const bytes = await readFile(join(outputDir, entry.localPath));
    if (bytes.length !== entry.bytes) {
      throw new CaptureProtocolError(
        "LOCAL_ASSET_CHANGED",
        `${entry.localPath} byte count changed before upload`
      );
    }
    const uploadResponse = await fetcher(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: bytes,
    });
    if (!uploadResponse.ok) {
      throw new CaptureProtocolError(
        "ASSET_UPLOAD_FAILED",
        `${entry.r2Key} returned ${uploadResponse.status}`
      );
    }
  }
  return manifest;
}
