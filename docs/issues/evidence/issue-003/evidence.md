# ISSUE-003 evidence

Variable-level only. No secret values are recorded here.

| file | content |
| --- | --- |
| `evidence.md` | Single-file summary of every §8 acceptance item |

Run date: 2026-07-25.

## §8 acceptance matrix

| # | Acceptance | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `pnpm lint` / `pnpm typecheck` / `pnpm test` / `tests/env.test.ts` green | PASS | `pnpm test` -> 100 files / 434 passed, exit 0. `tests/env.test.ts` 3/3. `pnpm lint` exit 0. `pnpm typecheck` exit 0. |
| 2 | `.env.example` 与代码 ENV_KEYS 对齐无漂移 | PASS | See `evidence.md` Variable correspondence table below. |
| 3 | Bootstrap 后 `getGeminiConfig().apiKey` 与 `getStepfunConfig().apiKey` 非空；`describe*` 不回显明文 | PASS | One-shot verify script (this dir, deleted after) reusing bootstrap shim: output `{"gemini":{"hasKey":true,"keyRevealPresent":false},"stepfun":{"hasKey":true,"keyRevealPresent":false}}` + `VERIFY=OK`. |
| 4 | `POST /api/settings` 用错 key 返回 422 且不覆盖 | PASS (code audit + bootstrap孪生) | `src/app/api/settings/route.ts:67-76` (validate before save) and `:105-113` (`keyValidationError` returns `{status:422}`) · Bootstrap `processProvider` implements the same non-overwrite contract: validation false -> return 'failed' -> save not invoked (see bootstrap-credentials.ts:106-114). |
| 5 | Bootstrap ends with non-zero exit when no key written or any failed; no secret printed | PASS | Bootstrap source `scripts/setup/bootstrap-credentials.ts:74-83,68-83` -> written==0 && failed==0 -> exitCode=2; failed>0 -> exitCode=1; success path prints only `[provider] configured (verifiedAt=now)`, redacts env value to empty string after save. |
| 6 | `.env*` not staged | PASS | `git status --porcelain` after each block staged only the intended file(s); see commits `21373af dba0fe3 473486c d65d6d6 7d25dba`. |
| 7 | Variable-name evidence present/absent table; no values | PASS | Below. |

## Variable correspondence table (issue §8 acceptance 2)

`.env.example` 与 Next 侧 ENV_KEYS 对齐 (only names; no values recorded).

| `.env.example` entry | Next-side consumer (file:lines) | role |
| --- | --- | --- |
| `DATABASE_URL=` | `src/lib/db/client.ts:34-35` (`initializePostgresDb`) | PostgreSQL 连接串 |
| `TEST_DATABASE_URL=` | `vitest.pg.config.ts:4` | pg 集成测试数据库 |
| `CVC_CREDENTIAL_MASTER_KEY=` | `src/features/credentials/credential-envelope.ts:45-63` | 凭据加密 master key，强制存在 |
| `BACKEND_ORIGIN=` | `next.config.ts:30` (rewrites 反代) | `/api/engine/:path*` -> worker |
| `NEXT_PUBLIC_API_BASE=` | `src/lib/api.ts:7` | 浏览器侧 BASE URL 覆盖 |
| `GEMINI_API_KEY=` | `scripts/setup/bootstrap-credentials.ts:69-72` (bootstrap 中转)  | 仅 bootstrap 一次性消费；运行时不读 env |
| `STEPFUN_API_KEY=` | `scripts/setup/bootstrap-credentials.ts:73-76` (bootstrap 中转) | 仅 bootstrap 一次性消费；运行时不读 env |
| `GEMINI_BASE_URL=` | `src/features/ai/gemini-config.ts:21-25` (`ENV_KEYS.baseUrl`) | 运行时 fallback |
| `GEMINI_PRIMARY_MODEL=` | `src/features/ai/gemini-config.ts:22` | 运行时 fallback |
| `GEMINI_FAST_MODEL=` | `src/features/ai/gemini-config.ts:23` | 运行时 fallback |
| `STEPFUN_BASE_URL=` | `src/features/ai/config.ts:65` | 运行时 fallback |
| `STEPFUN_CHAT_MODEL=` | `src/features/ai/config.ts:66` | 运行时 fallback |
| `STEPFUN_TTS_MODEL=` | `src/features/ai/config.ts:67` | 运行时 fallback |
| `STEPFUN_ASR_MODEL=` | `src/features/ai/config.ts:68` | 运行时 fallback |
| `STEPFUN_VISION_MODEL=` | `src/features/ai/config.ts:69` | 运行时 fallback |

`tests/env.test.ts` locks the present set (4 secret/non-secret names) and the
absent set (6 server-side names that previously leaked in): `STEP_API_KEY`,
`LISTENHUB_API_KEY`, `IMAP_PASSWORD`, `SIGNUP_PASSWORD`, `BROWSER_DRIVER`,
`PORT`.

## Bootstrap run summary

```text
$ pnpm tsx scripts/setup/bootstrap-credentials.ts
[Gemini] validating via real API...
[Gemini] configured (verifiedAt=now)
[StepFun] validating via real API...
[StepFun] configured (verifiedAt=now)

[bootstrap-credentials] written=2 skipped=0 failed=0
```

Postgres `provider_credentials` after bootstrap (verified via `docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -c "SELECT provider, verified_at IS NOT NULL AS verified, updated_at IS NOT NULL AS persisted, octet_length(ciphertext) AS cipher_len FROM provider_credentials ORDER BY provider;"`):

```text
 provider | verified | persisted | cipher_len 
----------+----------+-----------+------------
 gemini   | t        | t         |         53
 stepfun  | t        | t         |         65
```

`cipher_len` is the length of the AES-256-GCM ciphertext in bytes; small
non-zero values consistent with short API keys plus GCM padding. **No key
value is recorded.**

## One-shot verify run summary (issue §8 acceptance 3 detail)

A temporary `scripts/setup/_verify-credentials.tmp.mts` (deleted after run,
identical shim pattern as bootstrap) executed:

```ts
const { getGeminiConfig, describeGeminiConfig } = await import('@/features/ai/gemini-config')
const { getStepfunConfig, describeStepfunConfig } = await import('@/features/ai/config')
const gem = await getGeminiConfig()
const step = await getStepfunConfig()
const gemView = await describeGeminiConfig()
const stepView = await describeStepfunConfig()
// asserts hasKey=true for both; keyRevealPresent=false for both
```

Output:

```text
{"gemini":{"hasKey":true,"keyRevealPresent":false},"stepfun":{"hasKey":true,"keyRevealPresent":false}}
VERIFY=OK
```

`keyRevealPresent` is computed as `JSON.stringify(view).includes(apiKey)`. The
fact `describeGeminiConfig` does not expose `apiKey` as a property
(`gemini-config.ts:79-95`) is also mirrored by the contract test at
`gemini-config.test.ts:116` ("expect(view).not.toHaveProperty('apiKey')").

## Commits produced for ISSUE-003

| SHA | scope | files |
| --- | --- | --- |
| `21373af` | `docs(issues)` | `docs/issues/ISSUE-003-next-ai-credentials.md` (rewrite §1/§2.2/§2.3/§5/§8) |
| `dba0fe3` | `chore(config)` | `.env.example`, `tests/env.test.ts` (drop Next-side unconsumed vars; add 第 3 个 『absent』 断言) |
| `473486c` | `fix(config)` | `.env.example`, `tests/env.test.ts` (keep BACKEND_ORIGIN, drop PORT) |
| `d65d6d6` | `feat(setup)` | `scripts/setup/bootstrap-credentials.ts`, `scripts/setup/server-only-stub.js` |
| `7d25dba` | `docs(configuration)` | `docs/configuration/credentials.md` (147 lines) |

All five commits stage only their own files; no `.env*` ever staged;
`git status --porcelain` confirmed after each block. Pre-existing baseline
of other agents' unstaged changes (workflow/canvas/queue/ui) was left
untouched throughout.