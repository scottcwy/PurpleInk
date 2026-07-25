# M6 Product Route Shells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all Stage A Product/Release route shells, truthful unconnected states, six-step navigation, and permanent legacy-route redirects.

**Architecture:** A single `(product)` layout owns a lightweight product shell. Shared route-shell components render the required Stage B disclosure and future data-source names; a release-step component owns the six canonical links and active state. Individual pages remain thin, await Next 16 params, and never read databases or call engines.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Vitest, React DOM server rendering, Playwright CLI.

---

### Task 1: Lock the route-shell contract with failing tests

**Files:**
- Create: `tests/m6-route-shells.test.tsx`
- Create later: `src/app/(product)/_components/release-step-nav.tsx`
- Create later: `src/app/(product)/_components/unwired-panel.tsx`

- [ ] **Step 1: Write the failing route inventory test**

Create a test that checks these page files exist:

```ts
const routeFiles = [
  "src/app/(product)/login/page.tsx",
  "src/app/(product)/signup/page.tsx",
  "src/app/(product)/dashboard/page.tsx",
  "src/app/(product)/products/page.tsx",
  "src/app/(product)/products/[productId]/page.tsx",
  "src/app/(product)/releases/page.tsx",
  "src/app/(product)/releases/[releaseId]/brief/page.tsx",
  "src/app/(product)/releases/[releaseId]/flow/page.tsx",
  "src/app/(product)/releases/[releaseId]/evidence/page.tsx",
  "src/app/(product)/releases/[releaseId]/storyboard/page.tsx",
  "src/app/(product)/releases/[releaseId]/review/page.tsx",
  "src/app/(product)/releases/[releaseId]/artifacts/page.tsx",
  "src/app/(product)/releases/[releaseId]/sources/page.tsx",
  "src/app/(product)/releases/[releaseId]/render/page.tsx",
];
```

- [ ] **Step 2: Write the failing component truthfulness test**

Render `ReleaseStepNav` with `releaseId="release/1"` and `current="evidence"`; assert six encoded links and exactly one `aria-current="step"`. Render `UnwiredPanel` and assert the literal text `该页尚未接线（Stage B）` plus each supplied future source name.

- [ ] **Step 3: Run the red test**

Run:

```powershell
pnpm exec vitest run tests/m6-route-shells.test.tsx
```

Expected: FAIL because the `(product)` component modules and page files do not exist.

### Task 2: Implement the shared product shell and truthful primitives

**Files:**
- Create: `src/app/(product)/_components/product-app-shell.tsx`
- Create: `src/app/(product)/_components/unwired-panel.tsx`
- Create: `src/app/(product)/_components/release-step-nav.tsx`
- Create: `src/app/(product)/_components/release-step-page.tsx`
- Create: `src/app/(product)/_components/auth-shell-form.tsx`
- Create: `src/app/(product)/layout.tsx`

- [ ] **Step 1: Implement `UnwiredPanel`**

The component accepts `title`, `description`, and `sources`. It renders the required Stage B sentence, a short responsibility description, and source-name chips. It renders no count, progress, approval, success, failure, or connection claim.

- [ ] **Step 2: Implement `ReleaseStepNav`**

Use this immutable step list:

```ts
const RELEASE_STEPS = [
  ["brief", "Brief"],
  ["flow", "Flow"],
  ["evidence", "Evidence"],
  ["storyboard", "Storyboard"],
  ["review", "Review"],
  ["artifacts", "Artifacts"],
] as const;
```

Build each link as `/releases/${encodeURIComponent(releaseId)}/${step}` and set `aria-current="step"` only on the active step.

- [ ] **Step 3: Implement `ProductAppShell`**

Render a restrained ink-and-paper header with real links to `/dashboard`, `/products`, `/releases`, `/login`, and `/signup`. Mark the product area `Stage A · Route shell`; do not display account, Workspace, job, or database status.

- [ ] **Step 4: Implement release and auth wrappers**

`ReleaseStepPage` renders the release ID, six-step navigation, and `UnwiredPanel`. `AuthShellForm` renders disabled form controls and an explicit Stage B disclosure; submission is unavailable and no authentication state is claimed.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
pnpm exec vitest run tests/m6-route-shells.test.tsx
```

Expected: component assertions pass; route-inventory assertions remain red until Task 3.

### Task 3: Add all thin pages and redirects

**Files:**
- Create: `src/app/(product)/login/page.tsx`
- Create: `src/app/(product)/signup/page.tsx`
- Create: `src/app/(product)/dashboard/page.tsx`
- Create: `src/app/(product)/products/page.tsx`
- Create: `src/app/(product)/products/[productId]/page.tsx`
- Create: `src/app/(product)/releases/page.tsx`
- Create: `src/app/(product)/releases/[releaseId]/{brief,flow,evidence,storyboard,review,artifacts}/page.tsx`
- Create: `src/app/(product)/releases/[releaseId]/{sources,render}/page.tsx`

- [ ] **Step 1: Add account and collection shells**

`/login` and `/signup` render disabled form appearance with the exact unconnected disclosure. `/dashboard`, `/products`, and `/releases` use `UnwiredPanel` with only the future source names from `docs/conventions/routing.md`.

- [ ] **Step 2: Add the Product detail shell**

Await `params: Promise<{ productId: string }>` before rendering. Show the parameter as context, not as a fetched Product name, and list `Product`, `BrandKit`, `ProductCapability`, and `ProductFlow` as future sources.

- [ ] **Step 3: Add the six Release pages**

Every page awaits `params: Promise<{ releaseId: string }>` and passes one exact step key plus these sources:

```ts
brief: ["Release", "ReleaseBriefVersion", "ProductCapability"]
flow: ["ProductFlowVersion", "FlowNode", "ProductCapability"]
evidence: ["CaptureRun", "NodeEvidence", "SourceAsset", "EvidencePackage"]
storyboard: ["StoryboardVersion", "Scene", "NodeEvidence"]
review: ["Preview", "ReviewFeedback", "ApprovalRecord"]
artifacts: ["RenderJob", "RenderAttempt", "Artifact"]
```

- [ ] **Step 4: Add permanent redirects**

Await each `releaseId`, then call:

```ts
permanentRedirect(`/releases/${encodeURIComponent(releaseId)}/evidence`);
permanentRedirect(`/releases/${encodeURIComponent(releaseId)}/artifacts`);
```

- [ ] **Step 5: Run the green focused test**

Run:

```powershell
pnpm exec vitest run tests/m6-route-shells.test.tsx
```

Expected: all route inventory and rendered component assertions pass.

### Task 4: Verify routing, docs, and quality gates

**Files:**
- Modify: `docs/migration/stage-a-report.md`
- Verify: `docs/conventions/routing.md`

- [ ] **Step 1: Run static gates**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

Expected: all exit 0 and the build route table lists all 12 200 routes plus the two redirect routes.

- [ ] **Step 2: Run production HTTP acceptance**

Start Next production on port 3000. Request the 12 canonical routes with literal acceptance IDs and assert status 200. Request `/releases/release-acceptance/sources` and `/render` without following redirects and assert 308 plus the correct `Location`.

- [ ] **Step 3: Run Chromium acceptance**

Open `/releases/release-acceptance/evidence`, verify all six links, `Evidence` as the only current step, the exact Stage B disclosure, and future sources including `CaptureRun` and `NodeEvidence`. Capture a screenshot under `docs/migration/evidence/`.

- [ ] **Step 4: Reconcile documentation**

Compare every route row in `docs/conventions/routing.md` with the actual page file list. Record route statuses, guard matrix, HTTP results, focused test results, quality gates, and screenshot path in the Stage A report.

- [ ] **Step 5: Commit M6**

Stage only M6 implementation, tests, report, and evidence. Inspect `git diff --cached --name-status`, then commit:

```powershell
git commit -m "feat: add product workflow route shells"
```
