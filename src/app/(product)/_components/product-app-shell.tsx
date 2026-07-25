import type { ReactNode } from "react";
import { ProductSidebar } from "./product-sidebar";

export function ProductAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ds-app-gradient text-ds-text flex min-h-screen">
      <ProductSidebar />
      <div id="main-content" className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
