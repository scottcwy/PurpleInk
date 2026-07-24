import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import DashboardPage from "@/app/dashboard/page";
import ProductsPage from "@/app/products/page";
import ProductOverviewPage from "@/app/products/[productId]/page";
import ProductFlowsPage from "@/app/products/[productId]/flows/page";
import ProductFlowPage from "@/app/products/[productId]/flows/[flowId]/page";
import ReleasesPage from "@/app/releases/page";
import { AppShell } from "@/components/control-plane/app-shell";
import { renderReleasePage } from "@/components/releases/release-page";
import type { ReleaseStepSlug } from "@/lib/releases/domain";

describe("frontend-only route boundaries", () => {
  it.each([
    [LoginPage, "Authentication service unavailable"],
    [SignupPage, "Workspace registration unavailable"],
  ])("does not expose a fake submit action on %s", (Page, message) => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain(message);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('role="alert"');
  });

  it("keeps unavailable workspace navigation honest", () => {
    const html = renderToStaticMarkup(
      <AppShell currentPath="/dashboard" title="Dashboard">
        <p>Content</p>
      </AppShell>
    );

    expect(html).toContain("Workspace data unavailable");
    expect(html).not.toContain(">Settings<");
  });

  it("presents the dashboard as a switcher and release canvas without faking an agent", () => {
    const html = renderToStaticMarkup(<DashboardPage />);

    expect(html).toContain("What are you launching?");
    expect(html).toContain('aria-label="Workspace switcher"');
    expect(html).toContain('data-dashboard-canvas="true"');
    expect(html).toContain("Workspace service required");
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Create release/);
    expect(html).not.toContain("New Chat");
    expect(html).not.toContain("Creative Agent");
  });
});

describe("product route UI", () => {
  it("presents the product collection as an honest workspace canvas", () => {
    const html = renderToStaticMarkup(<ProductsPage />);

    expect(html).toContain("Which product belongs in your library?");
    expect(html).toContain('aria-label="Workspace switcher"');
    expect(html).toContain('data-collection-canvas="products"');
    expect(html).toContain("Product service required");
    expect(html).toMatch(
      /<input(?=[^>]*name="productName")(?=[^>]*disabled)[^>]*>/
    );
    expect(html).toMatch(/<input[^>]*type="url"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Add product/);
    expect(html).toContain("Brand kit readiness");
    expect(html).toContain("Approved flows");
    expect(html).not.toContain("Acme");
  });

  it("renders the product detail anatomy without inventing a product", async () => {
    const page = await ProductOverviewPage({
      params: Promise.resolve({ productId: "product-123" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Product unavailable");
    expect(html).toContain("Product summary");
    expect(html).toContain("Brand kit");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Recent releases");
    expect(html).not.toContain("Acme");
  });

  it("renders the flow collection anatomy without fixture rows", async () => {
    const page = await ProductFlowsPage({
      params: Promise.resolve({ productId: "product-123" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Flow library unavailable");
    expect(html).toContain("Search and filters");
    expect(html).toContain("Flow results");
  });

  it("renders the workbench anatomy without client-owned flow truth", async () => {
    const page = await ProductFlowPage({
      params: Promise.resolve({
        productId: "product-123",
        flowId: "flow-123",
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Flow unavailable");
    expect(html).toContain("Flow toolbar");
    expect(html).toContain("Semantic canvas");
    expect(html).toContain("Node inspector");
  });
});

describe("release route UI", () => {
  const routes: ReadonlyArray<
    readonly [ReleaseStepSlug, string, ReadonlyArray<string>]
  > = [
    ["brief", "Brief unavailable", ["Structured brief", "Version history"]],
    [
      "flow",
      "Flow selection unavailable",
      ["Reusable flows", "Version detail"],
    ],
    ["evidence", "Evidence unavailable", ["Run context", "Evidence inspector"]],
    ["storyboard", "Storyboard unavailable", ["Scene sequence", "Provenance"]],
    ["review", "Preview unavailable", ["Preview player", "Review feedback"]],
    [
      "artifacts",
      "Artifacts unavailable",
      ["Render status", "Artifact delivery"],
    ],
  ];

  it("presents the release collection as an honest workspace canvas", () => {
    const html = renderToStaticMarkup(<ReleasesPage />);

    expect(html).toContain("What are you releasing?");
    expect(html).toContain('aria-label="Workspace switcher"');
    expect(html).toContain('data-collection-canvas="releases"');
    expect(html).toContain("Release service required");
    expect(html).toContain("Product selection unavailable");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Create release/);
    expect(html).toContain("Current stage");
    expect(html).toContain("Pending approvals");
    expect(html).not.toContain('name="releaseIntent"');
    expect(html).not.toContain("approved claim");
    expect(html).not.toContain("Acme");
  });

  it.each(routes)(
    "renders the %s stage contract",
    async (step, message, regions) => {
      const page = await renderReleasePage("release-123", step);
      const html = renderToStaticMarkup(page);

      expect(html).toContain(message);
      expect(html).toContain("Release state unavailable");
      expect(html).toContain('aria-label="Release steps"');
      for (const region of regions) expect(html).toContain(region);
      expect(html).not.toContain("Acme");
    }
  );
});
