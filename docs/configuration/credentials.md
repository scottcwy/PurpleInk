# AI Provider Credentials

PurpleInk has isolated server-side credential paths for the Next application
and the backend worker. Within Next, platform-managed providers and
workspace-owned custom providers also remain strictly separated.

It exists to resolve the truth drift recorded in
`docs/issues/ISSUE-003-next-ai-credentials.md`. The text here is binding for
anyone wiring credentials; any change to the boundary must update this file
first and code second.

## 1. Two credential stores, by design

| | Next application (Director canvas pipeline) | Backend worker (server/) |
| --- | --- | --- |
| Process | `pnpm dev`, `next start` | `pnpm dev:worker`, `node server/src` |
| Secrets env file (git-ignored) | root `./.env.local` | `./server/.env` |
| Variable naming | 托管服务使用 `CVC_MANAGED_STEPFUN_API_KEY`、`CVC_MANAGED_MIMO_API_KEY`、`CVC_MANAGED_GEMINI_API_KEY` | `GEMINI_API_KEY`, `STEP_API_KEY`, `STEP_*` |
| Runtime resolution | 三家内置托管服务只读 server-only env；自定义 OpenAI-compatible 继续使用 DB 加密凭据 | env only |
| Bootstrap writer | `scripts/setup/bootstrap-credentials.ts` 仅服务历史/自定义凭据，不是内置托管服务主路径 | none (worker reads env at start) |
| Truth hierarchy | 托管目录 + `CVC_MANAGED_*`；自定义路由 → DB 加密凭据 | env → code default |
| Cache | none — every call re-reads DB and env (see `config.ts:77-92`, `gemini-config.ts:38-53`) | none |

The worker's legacy names and Next's `CVC_MANAGED_*` names belong to different
process trees. Do not introduce a shared loader or a unified env file.

This boundary mirrors `docs/issues/README.md` §0 and is enforced by:
`scripts/setup/server-only-stub.js` + the bootstrap script's exclusive use of
`loadEnvConfig(process.cwd())` (which reads the root `.env.local`, never
`server/.env`).

## 2. Next 的托管 Key 与自定义 BYOK 边界

`src/features/ai/managed-credentials.ts` 是三家内置服务的唯一平台 Key
解析器，只接受 `CVC_MANAGED_STEPFUN_API_KEY`、
`CVC_MANAGED_MIMO_API_KEY` 和 `CVC_MANAGED_GEMINI_API_KEY`。
`provider_credentials` 同时服务自定义 OpenAI-compatible 与三家内置厂商的
workspace BYOK。三家内置厂商默认使用托管服务；只有 workspace 显式选择
`byok` 时才解密对应行，选择 `managed` 时绝不把该行当作平台 Key fallback。

内置 StepFun、MiMo、Gemini 的托管路径不得回退到旧的 provider env 名称或 workspace
凭据；自定义 OpenAI-compatible 也不得回退到平台托管 Key。两条凭据链必须保持隔离。

## 3. 历史/自定义凭据的 cold-start bootstrap

`scripts/setup/bootstrap-credentials.ts` is the credential-side sibling of
`scripts/migration/provision-master-key.ts`. It exists so a freshly cloned
machine can seed legacy or custom encrypted workspace credentials without
manually POSTing through `/api/settings`. It does not provision managed
StepFun、MiMo 或 Gemini platform keys.

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

**Workspace boundary (post PLAN-002 phase B).** Provider credentials are
per-workspace: `save`/`validate` resolve the target workspace through
`currentWorkspaceId()`, so bootstrap wraps its work in
`runInAuthContext({ workspaceId: LOCAL_WORKSPACE_ID, userId: 'system:bootstrap' })`.
That means **bootstrap only ever writes the first owner workspace** (the
historical `LOCAL_WORKSPACE_ID` anchor). OpenAI-compatible custom endpoints
continue to use this per-workspace encrypted path.

StepFun, Gemini, and MiMo platform service credentials are a separate,
explicitly managed path. They resolve only from `CVC_MANAGED_STEPFUN_API_KEY`,
`CVC_MANAGED_GEMINI_API_KEY`, and `CVC_MANAGED_MIMO_API_KEY`. A workspace may
instead select BYOK; that source is encrypted in `provider_credentials` and
does not consume the membership pool. Neither path is a fallback for the
other, and neither secret is ever returned to the client.
Membership and usage accounting remain workspace-scoped. See
`docs/configuration/billing.md`.

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

1. `.env.local` 可保存 `CVC_MANAGED_*` 平台托管 Key；文件被 Git 忽略且不得提交，
   Key 不得写入数据库、客户端、日志、错误或截图。
2. 示例环境文件只能列空变量名，不得包含任何真实平台 Key。
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
