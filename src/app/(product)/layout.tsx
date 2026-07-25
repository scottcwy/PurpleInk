import type { ReactNode } from "react";
import { ProductAppShell } from "./_components/product-app-shell";

export default function ProductLayout({ children }: { children: ReactNode }) {
  return <ProductAppShell>{children}</ProductAppShell>;
}
