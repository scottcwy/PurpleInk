import { AppShell } from "@/components/control-plane/app-shell";
import { Breadcrumbs } from "@/components/control-plane/breadcrumbs";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default async function ProductFlowsPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<ReactNode> {
  const { productId } = await params;

  return (
    <AppShell
      currentPath={`/products/${productId}/flows`}
      title="Product flows"
      description="Approved semantic product paths reusable across releases."
    >
      <Breadcrumbs
        items={[
          { label: "Products", href: "/products" },
          { label: "Product", href: `/products/${productId}` },
          { label: "Flows" },
        ]}
      />
      <ServiceBoundary
        title="Flow library unavailable"
        description="The collection UI is ready, but ProductFlow queries and creation commands are not connected."
        regions={["Search and filters", "Flow results", "Pagination"]}
      />
    </AppShell>
  );
}
