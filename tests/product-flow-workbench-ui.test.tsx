import { FlowWorkbench } from "@/components/product-flow/flow-workbench";
import { mockFlow } from "@/tests/fixtures/product-flow";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("ProductFlow workbench UI", () => {
  it("keeps browser clicks inside the inspector instead of promoting them to nodes", () => {
    const html = renderToStaticMarkup(<FlowWorkbench initialFlow={mockFlow} />);

    expect(html).toContain("Create the campaign");
    expect(html).toContain("Collect focused review");
    expect(html).not.toContain("Choose New campaign</strong>");
  });

  it("always exposes all required inspector sections", () => {
    const html = renderToStaticMarkup(<FlowWorkbench initialFlow={mockFlow} />);

    for (const section of [
      "Capabilities",
      "Actions",
      "Assertions",
      "Evidence",
      "Errors",
    ]) {
      expect(html).toContain(section);
    }
    expect(html).toContain("No errors in the latest execution");
  });

  it("keeps the selected node readable through semantic theme tokens", () => {
    const html = renderToStaticMarkup(<FlowWorkbench initialFlow={mockFlow} />);

    expect(html).toContain("bg-background text-foreground");
    expect(html).toContain("text-muted-foreground");
  });

  it("lets semantic nodes fit the mobile canvas before enabling desktop width", () => {
    const html = renderToStaticMarkup(<FlowWorkbench initialFlow={mockFlow} />);

    expect(html).toContain("min-w-0");
    expect(html).toContain("sm:min-w-[36rem]");
  });
});
