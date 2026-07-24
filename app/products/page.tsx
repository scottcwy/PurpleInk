import { AppShell } from "@/components/control-plane/app-shell";
import { CollectionCanvas } from "@/components/control-plane/collection-canvas";
import type { ReactNode } from "react";

export default function ProductsPage(): ReactNode {
  return (
    <AppShell
      currentPath="/products"
      title="Product library"
      description="Persistent product records and their approved release evidence."
      variant="canvas"
    >
      <CollectionCanvas kind="products" />
    </AppShell>
  );
}
