import { CaptureProtocolError } from "./protocol.mjs";
import { publishEvidenceManifest } from "./uploader.mjs";

const stableErrorCode = (error) =>
  /^[A-Z][A-Z0-9_]{2,63}$/.test(error?.code ?? "") ? error.code : "WORKER_EXECUTION_FAILED";

export class CaptureControlPlaneClient {
  constructor({ baseUrl, workloadToken, workspaceId, jobId, attempt, fetcher = fetch, publisher = publishEvidenceManifest, handoffPollIntervalMs = 1_000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.workloadToken = workloadToken;
    this.workspaceId = workspaceId;
    this.jobId = jobId;
    this.attempt = attempt;
    this.fetcher = fetcher;
    this.publisher = publisher;
    this.handoffPollIntervalMs = handoffPollIntervalMs;
  }

  async run({ outputDir, adapter }) {
    let leaseToken;
    let heartbeatTimer;
    let eventSeq = 0;
    try {
      const lease = await this.#post("lease", { ttlMs: 120_000 });
      leaseToken = lease.leaseToken;
      if (typeof leaseToken !== "string" || !lease.payload) {
        throw new CaptureProtocolError("LEASE_INVALID", "control plane returned an invalid lease");
      }
      await this.#post("heartbeat", { leaseToken });
      heartbeatTimer = setInterval(() => {
        void this.#post("heartbeat", { leaseToken }).catch(() => undefined);
      }, 10_000);
      heartbeatTimer.unref?.();
      await this.#event(leaseToken, ++eventSeq, "attempt_started", {});
      const manifest = await adapter.run(lease.payload, outputDir, {
        handoff: async ({ prompt }) => {
          const config = lease.payload.handoff;
          if (!config || typeof config.remoteControlUrl !== "string") {
            throw new CaptureProtocolError("HANDOFF_PROVIDER_REQUIRED", "user handoff requires a remote-control provider URL");
          }
          await this.#event(leaseToken, ++eventSeq, "user_action_required", { prompt });
          const created = await this.#post("handoff", {
            leaseToken,
            action: "create",
            remoteControlUrl: config.remoteControlUrl,
            ttlMs: Number(config.ttlMs ?? 300_000),
          });
          if (typeof created.id !== "string") {
            throw new CaptureProtocolError("HANDOFF_INVALID", "control plane returned an invalid handoff");
          }
          const deadline = Date.now() + Number(config.ttlMs ?? 300_000);
          while (Date.now() < deadline) {
            const status = await this.#post("handoff", {
              leaseToken,
              action: "status",
              handoffId: created.id,
            });
            if (status.closed === true && status.resumed === true) {
              await this.#event(leaseToken, ++eventSeq, "user_action_resumed", { handoffId: created.id });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, this.handoffPollIntervalMs));
          }
          throw new CaptureProtocolError("HANDOFF_TIMEOUT", "user handoff expired before Resume");
        },
      });
      await this.publisher({
        manifest,
        outputDir,
        signUploadsUrl: this.#url("uploads/sign"),
        workloadToken: this.workloadToken,
        requestFields: { workspaceId: this.workspaceId, attempt: this.attempt, leaseToken },
        fetcher: this.fetcher,
      });
      await this.#event(leaseToken, ++eventSeq, "manifest_uploaded", { entryCount: manifest.entries.length });
      await this.#post("callback", { leaseToken, status: "completed", manifest });
      return manifest;
    } catch (error) {
      if (leaseToken) {
        await this.#post("callback", {
          leaseToken,
          status: "failed",
          errorCode: stableErrorCode(error),
          diagnostic: String(error?.message ?? error).slice(0, 2_000),
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  #event(leaseToken, seq, eventType, payload) {
    return this.#post("events", { leaseToken, events: [{ seq, eventType, payload }] });
  }

  #url(path) {
    return `${this.baseUrl}/jobs/${encodeURIComponent(this.jobId)}/${path}`;
  }

  async #post(path, fields) {
    const response = await this.fetcher(this.#url(path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.workloadToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: this.workspaceId,
        attempt: this.attempt,
        ...fields,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const rejection = body?.error;
      const detail = typeof rejection?.code === "string" && typeof rejection?.message === "string"
        ? ` (${rejection.code}: ${rejection.message})`
        : "";
      throw new CaptureProtocolError("CONTROL_PLANE_REJECTED", `${path} returned ${response.status}${detail}`);
    }
    return response.json();
  }
}
