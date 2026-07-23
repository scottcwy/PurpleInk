# PurpleInk

PurpleInk is a continuous release-video system for browser-delivered products. It turns approved product evidence into structured, reviewable, reproducible, and channel-ready launch videos.

## Language · 词表

**PurpleInk**:
The product and brand that turns verified product evidence into repeatable release videos.
_Avoid_: Kraft, Nexus AI, AI design generator, generic AI video tool

**Verified**:
A status meaning a factual claim or product shot can be traced to an approved SourceAsset or NodeEvidence record.
_Avoid_: AI-verified, automatically true, generated proof

**Product**:
A customer's software product for which PurpleInk continuously produces release content.
_Avoid_: Video project, generation, campaign

**Release**:
One product-launch production that binds an approved brief, ProductFlowVersion, Storyboard, and delivered Artifacts.
_Avoid_: Project, campaign, generation

**ReleaseBrief**:
The approved audience, message, proof points, channel, and CTA for one release.
_Avoid_: Prompt, script request, project description

**BrandKit**:
The reusable logo, color, type, voice, CTA, and motion rules for one Product.
_Avoid_: Theme, style preset, skin

**ProductFlow**:
A reusable, product-owned graph of approved business-meaningful product steps discovered or executed through the browser.
_Avoid_: DemoFlow, bot session, browser trace, random browsing

**ProductFlowVersion**:
An immutable approved version of a ProductFlow that can be referenced by one or more Releases.
_Avoid_: Current flow, mutable flow

**FlowNode**:
One business-meaningful product step containing its browser actions, checkpoint, and resulting evidence.
_Avoid_: Click, event, trace step, feature

**ProductCapability**:
A user-visible product function that one or more FlowNodes can prove.
_Avoid_: FlowNode, step, scene, claim

**DiscoveryRun**:
A bounded exploratory browser session that proposes a draft ProductFlowVersion.
_Avoid_: CaptureRun, autonomous crawl, random browsing

**CaptureRun**:
A recorded execution of a ProductFlowVersion with status and node-level checkpoints.
_Avoid_: Recording, take, capture job

**NodeEvidence**:
Attributable screenshots, clips, checkpoints, and summaries produced by one FlowNode execution in a CaptureRun.
_Avoid_: Source, node, generated UI

**SourceAsset**:
An attributable input asset such as a screenshot, recording, logo, font, or audio file.
_Avoid_: Generated UI, visual, content

**EvidenceRef**:
A typed reference to either approved NodeEvidence or an approved SourceAsset inside one immutable EvidencePackageVersion. Browser actions, state changes, and functional outcomes require NodeEvidence; SourceAsset supports only static media, brand, font, or audio inputs.
_Avoid_: Unverified upload, arbitrary asset id, browser fallback

**EvidencePackageVersion**:
The immutable, release-pinned set of approved EvidenceRefs and their capture provenance consumed by Storyboard and LaunchVideoPlan.
_Avoid_: Mutable evidence list, upload folder, EvidenceManifest

**Storyboard**:
The structured narrative contract that orders Scenes and binds their goals, copy, evidence, layout, and duration.
_Avoid_: Timeline, edit, script

**Scene**:
One narrative unit with one primary message and its supporting copy, source, layout, and duration.
_Avoid_: Slide, screen, clip

**Template**:
A reusable rule set mapping Storyboard content to visual layout, motion, and aspect-ratio behavior.
_Avoid_: Theme, preset pack, design style

**Artifact**:
A delivered output such as an MP4, preview, cover frame, or quality report.
_Avoid_: Generation, render, file

## Relationships · 关系

- One **Product** has one or more versioned **BrandKits**.
- One **Product** has zero or more **Releases**.
- One **Product** has zero or more **ProductFlows**.
- One **ProductFlow** has one or more immutable **ProductFlowVersions**.
- One **ProductFlowVersion** contains one or more **FlowNodes** and can be referenced by one or more **Releases**.
- One **FlowNode** can prove zero or more **ProductCapabilities**; one **ProductCapability** can be proved by one or more **FlowNodes**.
- One **DiscoveryRun** proposes exactly one draft **ProductFlowVersion**.
- One **CaptureRun** executes exactly one **ProductFlowVersion** and produces one or more **NodeEvidence** records for its completed **FlowNodes**.
- One **Release** has one or more **ReleaseBrief** versions and can pin exactly one approved **ProductFlowVersion** at a time.
- One **Release** can have one or more **CaptureRuns** and one **Storyboard** aggregate.
- One **Storyboard** contains one or more **Scenes**.
- Each factual **Scene** references approved **EvidenceRefs** from the Release-pinned **EvidencePackageVersion**; browser behavior facts require **NodeEvidence**.
- One approved **Storyboard** can produce one or more channel-specific **Artifacts**.

## Example dialogue · 示例对话

> **Marketing:** "Can we say the new workflow is automatic?"
> **PurpleInk:** "Only if the approved SourceAsset or CaptureRun proves that behavior; otherwise mark it as a copy claim requiring approval."

> **Product:** "The UI changed after the last release."
> **PurpleInk:** "Create a new ProductFlowVersion, re-run the affected FlowNodes, and replace only the Scenes linked to changed evidence."

## Flagged ambiguities · 已澄清歧义

- "Project" previously mixed the persistent customer Product with a one-time video effort; use **Product** for the persistent object and **ReleaseBrief** for one release.
- "Video generation" implied unconstrained synthetic output; PurpleInk produces release **Artifacts** from approved evidence and structured story data.
- "AI video" is a market category, not the canonical product definition; the preferred category is **verified product video** or **continuous release video**.
- "Flow node" previously risked meaning either a low-level browser click or a product feature; **FlowNode** now means a business-meaningful product step, while clicks remain internal actions and the feature being proved is a **ProductCapability**.
- "DemoFlow" described only a pre-authored test path; **ProductFlow** now includes bounded Agent discovery followed by user approval and immutable versioning.
