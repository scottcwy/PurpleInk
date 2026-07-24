import { AppShell } from "@/components/control-plane/app-shell";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default function ProductsPage(): ReactNode {
  return (
    <AppShell
      currentPath="/products"
      title="Products"
      description="Persistent product records and their approved release evidence."
    >
      <ServiceBoundary
        title="Product service unavailable"
        description="No products yet can be determined until product queries and creation commands are connected."
        regions={["Search and filters", "Product results", "Pagination"]}
      />
    </AppShell>
  );
}
