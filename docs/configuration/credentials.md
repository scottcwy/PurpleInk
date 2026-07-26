# AI Provider Credentials

PurpleInk has **two isolated credential stores** for AI providers — one per
process tree, never shared, never cross-loaded. This file is the canonical
description of the boundary and the cold-start flow that gets keys into the
Next application's encrypted Postgres store.

It exists to resolve the truth drift recorded in
`docs/issues/ISSUE-003-next-ai-credentials.md`. The text here is binding for
anyone wiring credentials; any change to the boundary must update this file
first and code second.

## 1. Two credential stores, by design

| | Next application (Director canvas pipeline) | Backend worker (server/) |
| --- | --- | --- |
| Process | `pnpm dev`, `next start` | `pnpm dev:worker`, `node server/src` |
| Secrets env file (git-ignored) | root `./.env.local` | `./server/.env` |
| Variable naming | `GEMINI_API_KEY`, `STEPFUN_API_KEY`, `STEPFUN_*_MODEL` | `GEMINI_API_KEY`, `STEP_API_KEY`, `STEP_*` |
| Runtime resolution | DB 加密存储 (`provider_credentials`) only — no env fallback for `apiKey` | env only |
| Bootstrap writer | `scripts/setup/bootstrap-credentials.ts` | none (worker reads env at start) |
| Truth hierarchy | DB route → env (model/endpoint only) → code default | env → code default |
| Cache | none — every call re-reads DB and env (see `config.ts:77-92`, `gemini-config.ts:38-53`) | none |

The duplicate `GEMINI_API_KEY` *name* on both sides is intentional isolation,
not a duplicate to be de-duplicated. Same for `STEP_API_KEY` (server) vs
`STEPFUN_API_KEY` (Next) — they address the same provider but live in
different stores with different surrounding models. If you want both trees
to use the same key, copy the **value** across; do **not** introduce a
shared loader or a unified env file.

This boundary mirrors `docs/issues/README.md` §0 and is enforced by:
`scripts/setup/server-only-stub.js` + the bootstrap script's exclusive use of
`loadEnvConfig(process.cwd())` (which reads the root `.env.local`, never
`server/.env`).

## 2. Why API keys are DB-only on the Next side

`src/features/ai/gemini-config.ts`, `src/features/ai/config.ts`, and
`src/features/ai/model-routing.ts`
set `apiKey` exclusively from `deps.credentials.loadSecret(...)` against the
`provider_credentials` table. The `ENV_KEYS` maps on lines
`gemini-config.ts:21-25` and `config.ts:64-70` cover **only** `*_BASE_URL` and
`*_MODEL` fields; there is no `*_API_KEY` env fallback.

This is **not** a drift — it is a deliberate design locked by:

- `AGENTS.md` §7: "凭据只存加密内容，master key 只从 server-only 环境读取，
  **不得明文 fallback**".
- `src/features/ai/config.test.ts:119-130` — a regression test titled
  "uses model env values but never falls back to a plaintext credential env".
- `src/features/ai/gemini-config.test.ts:93-118` — a regression test titled
  "resolves encrypted credential/routes over env without exposing the key".

Anyone tempted to add `process.env.GEMINI_API_KEY ?? storedKey` inside
`getGeminiConfig()` / `getStepfunConfig()` will break both contract tests
and the AGENTS.md invarianant. **Do not.**

## 3. Cold-start bootstrap flow

`scripts/setup/bootstrap-credentials.ts` is the credential-side sibling of
`scripts/migration/provision-master-key.ts`. It exists so a freshly cloned
machine can take Next from "DB has no keys" to "DB has validated encrypted
keys" without manually POSTing through `/api/settings`.

Sequence on a clean clone (assuming Postgres is up via
`docker compose -f docker-compose.dev.yml up -d`):

```text
1. pnpm install
2. pnpm tsx scripts/migration/provision-master-key.ts --env .env.local
     # writes CVC_CREDENTIAL_MASTER_KEY (32-byte canonical base64) into .env.local
3. pnpm db:migrate
     # applies migrations; creates provider_credentials + workspaces + ...
4. Manually add to ./.env.local:
     GEMINI_API_KEY=<copy the value from server/.env line 'GEMINI_API_KEY='>
     STEPFUN_API_KEY=<copy the value from server/.env line 'STEP_API_KEY='>
   Note: if server/.env has a different value, you must still copy your own
   value here — the two files keep separate copies by design.
5. pnpm tsx scripts/setup/bootstrap-credentials.ts
     # for each provider: validate via real API -> save encrypted -> clear env
   Output expected: written=2 skipped=0 failed=0
6. pnpm dev
     # Next reads provider_credentials; .env.local GEMINI/STEPFUN_API_KEY
     # are no longer consulted at runtime.
```

If you skip step 4, bootstrap prints `written=0 skipped=2 failed=0` and
exits 2. If a key fails real-API validation, bootstrap prints
`failed=1` and exits 1 **without** overwriting the existing encrypted row
— the same non-overwrite contract that `POST /api/settings` enforces
(see §4).

The bootstrap script also installs a `Module._resolveFilename` shim that
redirects the bare specifier `'server-only'` to an empty stub, so the script
can directly require Next source modules without booting Next. The shim is
scoped to that one tsx process and never touches the Next runtime path.

## 4. Runtime update path (post-bootstrap)

Once bootstrap has populated `provider_credentials`, the **only** way to
mutate the stored keys is `POST /api/settings`:

- Submit `apiKey: <candidate>` -> `validateKey(<candidate>)` first.
- Validation fails (`false`) -> server returns `422` and **does not** overwrite
  the existing row (`src/app/api/settings/route.ts:67-76`, `105-113`).
- Validation passes -> server saves encrypted blob with `verifiedAt = now`
  (`saveGeminiApiKey` in `gemini-config.ts:147`,
   `saveApiKey` in `stepfun-adapter.ts:20`).

This matches the routing convention §4.1 commit-3 invariant.
`describeGeminiConfig()` / `describeStepfunConfig()` return only
`value/source` pairs for model and endpoint fields; they deliberately
have no `apiKey` key at all (`gemini-config.ts:79-95`, `config.ts:126-146`),
so GET `/api/settings` cannot leak a secret to a browser.

## 5. OpenAI-compatible text providers

The settings page may register one workspace-scoped `openai-compatible`
provider. Its API key follows exactly the same encrypted
`provider_credentials` path as Gemini and StepFun; its endpoint and default
model are non-secret profile data in `workspace_settings` under
`ai.openai-compatible`. `POST /api/settings` first makes a minimal
`/chat/completions` request, then writes both records only after validation.

This provider is available only to Director text and vision routes. It never
owns narration TTS or subtitle ASR: those media routes can use MiMo or StepFun, so
that ingress timing, narration artifacts, and subtitle timing share one media
contract. GET `/api/settings` returns configured state, endpoint, model and
verification time, never the encrypted key.

## 6. StepFun endpoint and plan scope

The StepFun API key and the configured `baseUrl` are a pair. The ordinary
Open Platform endpoint is `https://api.stepfun.com/v1`; a Step Plan key must
use `https://api.stepfun.com/step_plan/v1` for both TTS and ASR. A successful
chat validation does not prove TTS entitlement, because voice synthesis is a
separately billed media capability. The settings page shows the Step Plan
endpoint explicitly so an operator can correct that pairing without changing
the encrypted key.

## 7. Security invariants (mirror AGENTS.md §7)

1. `.env.local` may carry `GEMINI_API_KEY` / `STEPFUN_API_KEY` as **values**;
   they're git-ignored and never committed.
2. `.env.example` lists those names with empty values only —
   `tests/env.test.ts:9-26` seals this.
3. Bootstrap and the runtime resolver refuse to proceed when
   `CVC_CREDENTIAL_MASTER_KEY` is absent or malformed
   (`credential-envelope.ts:45-63`).
4. No client-side code path reaches `getGeminiConfig` / `getStepfunConfig`:
   every consumer is `'server-only'`-tagged (Director pi-session,
   `vision-qa.ts`, `model-routing.ts`).
5. Bootstrap output unconditionally redacts secret values; only
   `provider name / configured / verifiedAt` summaries are printed.
6. `CVC_CREDENTIAL_MASTER_KEY` itself lives only in `.env.local`. To rotate
   it you must decrypt and re-encrypt every `provider_credentials` row, which
   is currently a manual operation; do not delete it casually — encrypted
   blobs become unrecoverable.

## 8. What does **not** belong here

- **YAML config files**. The truth ordering (DB > env > default) plus the
  bootstrap script and the `/api/settings` mutation surface already cover
  hot-reload of provider settings without introducing a fourth truth layer.
  See `docs/issues/ISSUE-003-next-ai-credentials.md` §4 for the reasoning.
- **A unified env loader.** The frontend/worker stores stay separate by §3
  of the same issue.
- **Env fallback for `apiKey`** at runtime. AGENTS.md §7 and two contract
  tests forbid it.
- **Listing backend-step (`server/.env`) variables in the root `.env.example`.**
  These create silent drift; `tests/env.test.ts:21-32` enforces the
  separation.
