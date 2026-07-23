# Server Bridge API (Deprecated)

The routes described below are a legacy prototype. They are not part of the accepted production browser architecture and must not be used by DiscoveryRun, CaptureRun, Golden E2E, or as a fallback.

The target control-plane boundary is `/api/internal/capture/jobs/*` for the Linux Playwright Capture Worker, with workload identity, `job_id + attempt` fencing, lease/heartbeat, isolated R2 prefixes, and callback manifest verification. That replacement is not implemented by this directory.

## Legacy behavior

The Next.js routes under `app/api/bridge/v1` expose the old Ego Capture Bridge V1 protocol. `BridgeService` owns pairing, device authentication, session transitions, event sequencing, revocation, expiry, upload intents, and manifest verification.

Authenticated Bridge requests require all of:

- `Authorization: Bearer <short-lived-token>`
- `x-bridge-timestamp`
- `x-bridge-nonce`
- `x-bridge-body-sha256`
- `x-bridge-signature`

The device signature binds the HTTP method, path including query, timestamp, nonce, and raw body hash. Nonces cannot be replayed.

R2 configuration:

- `R2_ACCOUNT_ID`
- `R2_EVIDENCE_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `BRIDGE_TOKEN_SECRET` as base64 for at least 32 bytes

Signed PUT URLs bind the session-owned R2 key, content length, MIME type, checksum, and SHA-256 metadata. Completion HEAD-checks every object before accepting `EvidenceManifestV1`.
