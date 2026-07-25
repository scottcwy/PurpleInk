# ISSUE-003 evidence directory

Holds truth-aligned, value-free evidence for `docs/issues/ISSUE-003-next-ai-credentials.md` §8.

Rules:
1. Only variable names, file paths, and boolean / count outcomes are recorded.
2. Any `apiKey` referenced in evidence text MUST be the *variable name*
   (e.g. "GEMINI_API_KEY"), never the actual key string.
3. Console output that did print a configured/verifiedAt state is acceptable;
   any output that printed a key value is not (none exists here by construction
   — see `bootstrap-credentials.ts:108` and `route.ts:42-49`).
4. When adding new evidence, append to `evidence.md` and link the commit SHA
   in the "Commits produced" table at the bottom.