import { AppShell } from "@/components/control-plane/app-shell";
import { Breadcrumbs } from "@/components/control-plane/breadcrumbs";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default async function ProductOverviewPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<ReactNode> {
  const { productId } = await params;

  return (
    <AppShell
      currentPath={`/products/${productId}`}
      title="Product"
      description="Reusable product identity, capabilities, flows, and releases."
    >
      <Breadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: "Product" }]}
      />
      <ServiceBoundary
        title="Product unavailable"
        description="The route is ready, but the product query and workspace ownership check are not connected."
        regions={[
          "Product summary",
          "Brand kit",
          "Capabilities",
          "Reusable flows",
          "Recent releases",
        ]}
      />
    </AppShell>
  );
}
