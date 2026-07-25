import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseStepNav } from "@/app/(product)/_components/release-step-nav";
import { UnwiredPanel } from "@/app/(product)/_components/unwired-panel";
import {
  STAGE_B_WORKFLOW_NODES,
  WORKFLOW_BLUEPRINT_EDGES,
} from "@/features/workflow/blueprint-model";

const ROUTE_FILES = [
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
] as const;

describe("M6 route shells", () => {
  it("materializes every canonical and redirect route file", () => {
    expect(ROUTE_FILES.filter((file) => !existsSync(file))).toEqual([]);
  });

  it("keeps the routing convention table aligned with every route file", () => {
    const routingDoc = readFileSync("docs/conventions/routing.md", "utf8");
    for (const file of ROUTE_FILES) {
      expect(routingDoc).toContain(`\`${file}\``);
    }
  });

  it("renders six encoded release links and exactly one current step", () => {
    const html = renderToStaticMarkup(
      createElement(ReleaseStepNav, {
        releaseId: "release/1",
        current: "evidence",
      })
    );

    for (const step of [
      "brief",
      "flow",
      "evidence",
      "storyboard",
      "review",
      "artifacts",
    ]) {
      expect(html).toContain(`/releases/release%2F1/${step}`);
    }
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(">Evidence<");
  });

  it("states the Stage B boundary and names only future data sources", () => {
    const html = renderToStaticMarkup(
      createElement(UnwiredPanel, {
        title: "真实证据",
        description: "未来在这里审阅真实采集证据。",
        sources: ["CaptureRun", "NodeEvidence"],
      })
    );

    expect(html).toContain("该页尚未接线（Stage B）");
    expect(html).toContain("CaptureRun");
    expect(html).toContain("NodeEvidence");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("审批通过");
  });

  it("keeps the seven-node Pencil workflow honest while Stage B is disconnected", () => {
    expect(STAGE_B_WORKFLOW_NODES).toHaveLength(7);
    expect(WORKFLOW_BLUEPRINT_EDGES).toHaveLength(7);
    expect(
      STAGE_B_WORKFLOW_NODES.every((node) => node.status === "unwired")
    ).toBe(true);
    expect(
      STAGE_B_WORKFLOW_NODES.every((node) => node.artifact === undefined)
    ).toBe(true);
    expect(STAGE_B_WORKFLOW_NODES.map((node) => node.title)).toEqual([
      "开始",
      "项目规划",
      "镜头生成",
      "媒体处理",
      "画面渲染",
      "视觉 QA",
      "项目合成",
    ]);
  });
});
