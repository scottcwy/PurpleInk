import { AppShell } from "@/components/control-plane/app-shell";
import { Breadcrumbs } from "@/components/control-plane/breadcrumbs";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default async function ProductFlowPage({
  params,
}: {
  params: Promise<{ productId: string; flowId: string }>;
}): Promise<ReactNode> {
  const { productId, flowId } = await params;

  return (
    <AppShell
      currentPath={`/products/${productId}/flows/${flowId}`}
      title="Product flow"
      description="A versioned semantic path with a stable canvas and inspector."
    >
      <Breadcrumbs
        items={[
          { label: "Products", href: "/products" },
          { label: "Product", href: `/products/${productId}` },
          { label: "Flows", href: `/products/${productId}/flows` },
          { label: "Flow" },
        ]}
      />
      <ServiceBoundary
        title="Flow unavailable"
        description="The workbench is ready, but no persistent ProductFlowVersion or approved Brief context is connected."
        regions={[
          "Flow toolbar",
          "Semantic canvas",
          "Node inspector",
          "Run and version context",
        ]}
      />
    </AppShell>
  );
}
