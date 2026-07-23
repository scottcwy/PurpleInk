import type { ProductFlow } from "@/lib/product-flow/types";

export const capabilities = {
  "cap-campaign": "Campaign setup",
  "cap-review": "Collaborative review",
  "cap-share": "Instant sharing",
  "cap-insights": "Engagement insights",
} as const;

export const mockFlow: ProductFlow = {
  id: "launch-campaign",
  productId: "frameio",
  name: "Launch a campaign",
  version: 7,
  status: "draft",
  startUrl: "https://demo.purpleink.app/campaigns",
  updatedAt: "Today, 22:41",
  nodes: [
    {
      id: "node-create",
      order: 1,
      title: "Create the campaign",
      intent: "Start a named launch campaign from the product dashboard.",
      capabilityIds: ["cap-campaign"],
      actions: [
        { id: "a1", kind: "navigate", label: "Open campaigns", effect: "read" },
        { id: "a2", kind: "click", label: "Choose New campaign", target: { by: "role", value: "New campaign", role: "button" }, effect: "read" },
        { id: "a3", kind: "fill", label: "Name from fixture", target: { by: "label", value: "Campaign name" }, effect: "idempotent_write" },
      ],
      checkpoints: [{ id: "c1", kind: "text_contains", label: "Campaign title is visible", status: "passed" }],
      evidence: [
        { id: "e1", kind: "result_screenshot", label: "Campaign overview", status: "approved" },
        { id: "e2", kind: "node_clip", label: "Create sequence · 3.2s", status: "approved" },
      ],
      execution: { status: "passed", duration: "4.8s" },
    },
    {
      id: "node-review",
      order: 2,
      title: "Collect focused review",
      intent: "Invite the launch team and resolve feedback in context.",
      capabilityIds: ["cap-review"],
      actions: [
        { id: "a4", kind: "click", label: "Open review", target: { by: "test_id", value: "review-panel" }, effect: "read" },
        { id: "a5", kind: "fill", label: "Add review note", target: { by: "placeholder", value: "Add a comment" }, effect: "idempotent_write" },
      ],
      checkpoints: [{ id: "c2", kind: "visible", label: "Review note appears", status: "failed" }],
      evidence: [{ id: "e3", kind: "dom_summary", label: "Review panel summary", status: "needs_review" }],
      execution: { status: "failed", duration: "12.0s", error: { code: "ASSERT_TEXT_MISMATCH", message: "Expected review note was not visible after 10 seconds." } },
    },
    {
      id: "node-share",
      order: 3,
      title: "Share the approved cut",
      intent: "Create a stable link for the approved campaign cut.",
      capabilityIds: ["cap-share"],
      actions: [
        { id: "a6", kind: "click", label: "Open share menu", target: { by: "role", value: "Share", role: "button" }, effect: "read" },
        { id: "a7", kind: "click", label: "Copy campaign link", target: { by: "text", value: "Copy link" }, effect: "read" },
      ],
      checkpoints: [{ id: "c3", kind: "visible", label: "Link ready confirmation", status: "passed" }],
      evidence: [{ id: "e4", kind: "result_screenshot", label: "Share confirmation", status: "approved" }],
      execution: { status: "passed", duration: "2.4s" },
    },
    {
      id: "node-insights",
      order: 4,
      title: "Read launch engagement",
      intent: "Show the team which launch moments earned attention.",
      capabilityIds: ["cap-insights"],
      actions: [{ id: "a8", kind: "navigate", label: "Open insights", effect: "read" }],
      checkpoints: [{ id: "c4", kind: "visible", label: "Engagement chart renders", status: "passed" }],
      evidence: [{ id: "e5", kind: "result_screenshot", label: "Engagement overview", status: "approved" }],
      execution: { status: "passed", duration: "3.1s" },
    },
  ],
};
