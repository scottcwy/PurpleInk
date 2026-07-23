import { AppShell } from "@/components/control-plane/app-shell";
import {
  EmptyState,
  primaryActionClassName,
} from "@/components/control-plane/empty-state";
import { Package, Plus } from "lucide-react";
import type { ReactNode } from "react";

export default function ProductsPage(): ReactNode {
  return (
    <AppShell
      currentPath="/products"
      title="Products"
      description="Persistent product records and their approved release evidence."
      action={
        <button className={primaryActionClassName} type="button">
          <Plus size={16} />
          <span className="hidden sm:inline">Add product</span>
        </button>
      }
    >
      <EmptyState
        icon={Package}
        title="No products yet"
        detail="Add the browser product you want to launch from."
        action={
          <button className={primaryActionClassName} type="button">
            <Plus size={16} />
            Add product
          </button>
        }
      />
    </AppShell>
  );
}
