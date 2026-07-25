"use client";

import { SmoothScroll } from "@/components/marketing/smooth-scroll";
import { ReducedMotionProvider } from "@/lib/marketing-motion";
import type { ReactNode } from "react";

export function MarketingProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <ReducedMotionProvider>
      <SmoothScroll>{children}</SmoothScroll>
    </ReducedMotionProvider>
  );
}
