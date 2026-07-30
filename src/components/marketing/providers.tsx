"use client";

import { SmoothScroll } from "@/components/marketing/smooth-scroll";
import type { ReactNode } from "react";

export function MarketingProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <SmoothScroll>{children}</SmoothScroll>;
}
