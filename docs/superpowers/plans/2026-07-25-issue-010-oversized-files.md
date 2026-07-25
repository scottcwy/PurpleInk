# ISSUE-010 Oversized Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the two oversized product client components by real responsibility, preserve behavior, and restore `pnpm verify:v3` to zero violations.

**Architecture:** Keep route pages and existing API modules unchanged. Turn each oversized file into a page-level composition root, move asynchronous state into focused hooks, and move media/review presentation into focused sibling components. Keep pure export option projection in the existing view-model module.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Vitest, Tailwind CSS, Playwright Chromium, pnpm 10.30.0.

---

## File map

- Create `src/app/products/(app)/shots/[shotId]/use-shot-runtime.ts`
  - Owns preview-code loading, render lifecycle, output URL, error state, and refresh.
- Create `src/app/products/(app)/shots/[shotId]/shot-player.tsx`
  - Owns video/iframe presentation, transport controls, and thumbnail loading.
- Create `src/app/products/(app)/shots/[shotId]/shot-detail-panels.tsx`
  - Owns the code and contract presentation panels.
- Modify `src/app/products/(app)/shots/[shotId]/shot-detail.tsx`
  - Remains the page composition root and TopBar wiring.
- Create `src/app/products/(app)/export/[projectId]/use-export-runtime.ts`
  - Owns readiness loading, export lifecycle, and optimistic resolution updates.
- Create `src/app/products/(app)/export/[projectId]/export-review.tsx`
  - Owns responsive settings chrome, export settings, and Final QA.
- Modify `src/app/products/(app)/export/[projectId]/export-view-model.ts`
  - Adds the pure resolution-option projection.
- Modify `src/app/products/(app)/export/[projectId]/export-view-model.test.ts`
  - Locks the new pure projection before production extraction.
- Modify `src/app/products/(app)/export/[projectId]/export-workspace.tsx`
  - Remains the page composition root, preview, and timeline.
- Modify `scripts/verify/v3-architecture-baseline.json`
  - Removes the two stale `src/app/legacy/**` entries.
- Modify `AGENTS.md`
  - Removes the paid-down known-debt entries.
- Create `docs/issues/evidence/issue-010/*`
  - Stores before/after screenshots and the verification record.

### Task 1: Capture the failing baseline and browser evidence

**Files:**
- Create: `docs/issues/evidence/issue-010/baseline.md`
- Create: `docs/issues/evidence/issue-010/shot-before.png`
- Create: `docs/issues/evidence/issue-010/export-before.png`

- [ ] **Step 1: Reproduce the architecture violation**

Run:

```powershell
pnpm verify:v3
```

Expected: exit 1 with exactly two `OVERSIZED_NEW_FILE` violations for
`shot-detail.tsx` and `export-workspace.tsx`.

- [ ] **Step 2: Start the real application dependencies**

Run Postgres with:

```powershell
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

Start `pnpm dev` as a hidden background process. Do not start a second server if
port 3000 is already served by this checkout.

- [ ] **Step 3: Resolve real page identifiers**

Use the existing application or database projection to select one real project
containing a `shot-codegen` node. Record the exact project ID, shot node ID,
viewport, and URLs in `baseline.md`. Do not create fixture-only UI data.

- [ ] **Step 4: Capture before screenshots and console state**

Open the exact shot and export URLs in real Chromium:

```text
/products/shots/<shotId>?projectId=<projectId>
/products/export/<projectId>
```

Save full-page screenshots as `shot-before.png` and `export-before.png`.
Record console errors and failed requests in `baseline.md`.

- [ ] **Step 5: Confirm no unrelated files were changed**

Run:

```powershell
git status --short
```

Expected: only pre-existing concurrent changes plus the three ISSUE-010 evidence
files; do not stage or commit this task yet because before/after evidence belongs
in the final verification commit.

### Task 2: Split the shot detail by runtime and presentation responsibility

**Files:**
- Create: `src/app/products/(app)/shots/[shotId]/use-shot-runtime.ts`
- Create: `src/app/products/(app)/shots/[shotId]/shot-player.tsx`
- Create: `src/app/products/(app)/shots/[shotId]/shot-detail-panels.tsx`
- Modify: `src/app/products/(app)/shots/[shotId]/shot-detail.tsx`

- [ ] **Step 1: Establish the refactor safety baseline**

Run:

```powershell
pnpm test -- "src/app/products/(app)/shots/[shotId]/shot-api.test.ts"
pnpm typecheck
```

Expected: both commands pass before extraction.

- [ ] **Step 2: Extract the runtime hook without changing state transitions**

Move `NO_CODE` and `useShotRuntime` into `use-shot-runtime.ts`. Preserve this
public contract:

```ts
export const NO_CODE = '分镜代码尚未生成'

export function useShotRuntime(
  projectId: string,
  nodeId: string,
  previewUrl?: string,
  initialOutputUrl?: string,
): {
  rendering: boolean
  outputUrl?: string
  sourceCode: string
  codeLoading: boolean
  codeError: boolean
  error?: string
  render: () => Promise<void>
}
```

Keep every effect dependency, error fallback, `artifactUrl` assignment, and
successful `router.refresh()` condition identical.

- [ ] **Step 3: Extract the media player**

Move `ShotPlayer`, `ThumbnailTrack`, and `THUMBNAIL_COUNT` into
`shot-player.tsx`, exporting only:

```ts
export function ShotPlayer(props: {
  outputUrl?: string
  previewUrl?: string
  error?: string
  projectId: string
  nodeId: string
  fps?: number
}): React.JSX.Element
```

Preserve the existing video events, thumbnail effect, transport controls,
iframe sandbox, DOM order, text, and classes verbatim.

- [ ] **Step 4: Extract code and contract presentation**

Move `ShotCode`, `codeSyncLabel`, and `ShotContract` to
`shot-detail-panels.tsx`. Export only `ShotCode` and `ShotContract`; keep
`codeSyncLabel` private.

- [ ] **Step 5: Reduce the entry file to composition**

Update `shot-detail.tsx` imports and keep `ShotDetail`, `ShotLink`, TopBar,
navigation context, and `ShotPanelChrome` composition. Do not change the JSX
branches or props passed to extracted components.

- [ ] **Step 6: Verify the shot refactor**

Run:

```powershell
pnpm test -- "src/app/products/(app)/shots/[shotId]/shot-api.test.ts"
pnpm typecheck
pnpm lint
pnpm verify:v3
git diff --check
```

Expected: tests, typecheck, lint, and diff check pass. `verify:v3` may still fail
only for `export-workspace.tsx`; no new oversized file is allowed.

- [ ] **Step 7: Commit the shot responsibility boundary**

Stage only the four shot files, inspect `git diff --cached --name-status`, then:

```powershell
git commit -m "refactor(shots): 拆分分镜详情职责"
```

### Task 3: Split export runtime and review UI with TDD

**Files:**
- Modify: `src/app/products/(app)/export/[projectId]/export-view-model.test.ts`
- Modify: `src/app/products/(app)/export/[projectId]/export-view-model.ts`
- Create: `src/app/products/(app)/export/[projectId]/use-export-runtime.ts`
- Create: `src/app/products/(app)/export/[projectId]/export-review.tsx`
- Modify: `src/app/products/(app)/export/[projectId]/export-workspace.tsx`

- [ ] **Step 1: Write the failing resolution-option projection test**

Add this test before production code:

```ts
import {
  buildResolutionOptions,
  buildShotClips,
  fullTrackClip,
} from './export-view-model'

it('projects every supported resolution preset to its existing tier label', () => {
  expect(buildResolutionOptions()).toEqual([
    { value: '1080x1920', label: '高清' },
    { value: '720x1280', label: '标清' },
    { value: '540x960', label: '流畅' },
  ])
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm test -- "src/app/products/(app)/export/[projectId]/export-view-model.test.ts"
```

Expected: FAIL because `buildResolutionOptions` is not exported.

- [ ] **Step 3: Implement the minimal pure projection**

Add to `export-view-model.ts`:

```ts
import {
  EXPORT_RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'

const RESOLUTION_TIER_LABEL: Record<ResolutionPreset, string> = {
  '1080x1920': '高清',
  '720x1280': '标清',
  '540x960': '流畅',
}

export function buildResolutionOptions() {
  return Object.keys(EXPORT_RESOLUTION_PRESETS).map((value) => ({
    value,
    label: RESOLUTION_TIER_LABEL[value as ResolutionPreset],
  }))
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
pnpm test -- "src/app/products/(app)/export/[projectId]/export-view-model.test.ts"
```

Expected: all export view-model tests pass.

- [ ] **Step 5: Extract the export runtime hook**

Move `useExportRuntime` unchanged into `use-export-runtime.ts`, exporting:

```ts
export function useExportRuntime(projectId: string): {
  readiness?: ExportReadiness
  outputUrl?: string
  error?: string
  exporting: boolean
  exportVideo: () => Promise<void>
  updateResolution: (preset: ResolutionPreset) => Promise<void>
}
```

Preserve the initial effect, optimistic update, PATCH failure text, and
fire-and-forget readiness reload exactly.

- [ ] **Step 6: Extract the responsive review region**

Move `ExportReview`, `ExportSettings`, and `ExportQa` to `export-review.tsx`.
Export only `ExportReview`. Replace the local resolution constants with:

```ts
const RESOLUTION_OPTIONS = buildResolutionOptions()
```

Preserve localStorage keys, breakpoints, drawer state, resize behavior, JSX
order, strings, and classes.

- [ ] **Step 7: Reduce the workspace to composition**

Keep `ExportWorkspace`, `ExportPreview`, and `ExportTimeline` in
`export-workspace.tsx`. Import `useExportRuntime` and `ExportReview`; do not
change prop values or disabled-state calculation.

- [ ] **Step 8: Verify the export refactor**

Run:

```powershell
pnpm test -- "src/app/products/(app)/export/[projectId]/export-view-model.test.ts"
pnpm test -- "src/app/products/(app)/export/[projectId]/export-api.test.ts"
pnpm typecheck
pnpm lint
pnpm verify:v3
git diff --check
```

Expected: tests, typecheck, lint, and diff check pass. Before baseline cleanup,
`verify:v3` must have no current shot/export path violations and no new
oversized files.

- [ ] **Step 9: Commit the export responsibility boundary**

Stage only the five export files, inspect the staged file list, then:

```powershell
git commit -m "refactor(export): 拆分导出工作区职责"
```

### Task 4: Retire stale debt records and prove behavior equivalence

**Files:**
- Modify: `scripts/verify/v3-architecture-baseline.json`
- Modify: `AGENTS.md`
- Modify: `docs/issues/ISSUE-010-oversized-files.md`
- Modify: `docs/issues/README.md`
- Modify: `docs/issues/evidence/issue-010/baseline.md`
- Create: `docs/issues/evidence/issue-010/shot-after.png`
- Create: `docs/issues/evidence/issue-010/export-after.png`

- [ ] **Step 1: Remove only the stale oversized baseline entries**

Delete these two keys from `oversizedFiles`:

```text
src/app/legacy/(app)/canvas/export/export-workspace.tsx
src/app/legacy/(app)/canvas/shot/[id]/shot-detail.tsx
```

Do not change any debt cap. Do not add the current product paths.

- [ ] **Step 2: Update repository debt documentation**

Remove the two paid-down file bullets from the `AGENTS.md` known-debt section.
If no listed debt remains in that subsection, replace it with a concise statement
that `verify:v3` must remain green rather than leaving an empty list.

- [ ] **Step 3: Run the complete static and test gate**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

Expected:

- every command exits 0;
- `verify:v3` reports `"ok": true` and an empty violations array;
- `debtCaps.directOpenAiClientImports` remains 3;
- no current shot/export path appears in `report.oversizedFiles`.

- [ ] **Step 4: Check file sizes and UTF-8 integrity**

Use `rg -n "^"` to count/inspect each modified or new production file.
Confirm both entry files and every new file are at most 250 lines.

Run a literal replacement-character scan across:

```text
AGENTS.md README.md docs src server scripts
```

Expected: zero U+FFFD matches. Do not treat the textual string `U+FFFD` as the
replacement character itself.

- [ ] **Step 5: Capture after screenshots**

Open the exact URLs and viewport recorded in `baseline.md`. Save:

```text
docs/issues/evidence/issue-010/shot-after.png
docs/issues/evidence/issue-010/export-after.png
```

Record console errors, failed requests, and comparison results. Existing
baseline errors may remain only if unchanged; no new console error is allowed.

- [ ] **Step 6: Compare before and after evidence**

Compare the screenshot dimensions and visible layout. Record a concise,
evidence-backed conclusion in `baseline.md`; do not claim pixel equality without
an actual image comparison.

- [ ] **Step 7: Close the issue ledger**

Change ISSUE-010 to `done` only after every required command and browser check
passes. Update the README table row to `done`. If any acceptance item cannot be
run, leave the issue open and record the exact blocker.

- [ ] **Step 8: Commit the verified closeout**

Stage only baseline, AGENTS, ISSUE-010 ledger, README row, and ISSUE-010 evidence.
Inspect `git diff --cached --name-status`, ensure no `.env*`, build output,
credentials, or unrelated Issue files are staged, then:

```powershell
git commit -m "chore(issue-010): 关闭超限文件债务"
```

## Execution choice

This repository session does not authorize subagent delegation. Execute this
plan inline with `superpowers:executing-plans`, pausing at commit boundaries if
new concurrent changes overlap an ISSUE-010 file.
