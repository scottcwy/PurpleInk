"use client";

import {
  Download,
  FolderKanban,
  LayoutDashboard,
  PanelTop,
  Waypoints,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  PurpleInkSidebar,
  type PurpleInkSidebarItem,
} from "@/components/ui/sidebar";
import { PRODUCTS_ROUTES } from "@/features/navigation/products-routes";

export function ProductSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const releaseId = pathname.match(/^\/releases\/([^/]+)/)?.[1];
  const items: readonly PurpleInkSidebarItem[] = [
    {
      href: PRODUCTS_ROUTES.dashboard,
      label: "工作台",
      icon: LayoutDashboard,
      active: pathname === PRODUCTS_ROUTES.dashboard,
    },
    {
      href: PRODUCTS_ROUTES.projects,
      label: "项目",
      icon: FolderKanban,
      active: pathname.startsWith(PRODUCTS_ROUTES.projects),
    },
    {
      href: releaseId ? `/releases/${releaseId}/flow` : "/releases",
      label: "画布",
      icon: Waypoints,
      active: isCanvasRoute(pathname),
    },
    {
      href: releaseId ? `/releases/${releaseId}/storyboard` : undefined,
      label: "镜头",
      icon: PanelTop,
      active: pathname.endsWith("/storyboard") || pathname.endsWith("/review"),
      disabledReason: "请先选择一个 Release",
    },
    {
      href: releaseId ? `/releases/${releaseId}/artifacts` : undefined,
      label: "导出",
      icon: Download,
      active: pathname.endsWith("/artifacts"),
      disabledReason: "请先选择一个 Release",
    },
  ];

  return (
    <PurpleInkSidebar
      items={items}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      accountOpen={accountOpen}
      onAccountOpenChange={setAccountOpen}
      className="sticky top-0 z-30 h-screen"
    />
  );
}

function isCanvasRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/releases") &&
    !pathname.endsWith("/storyboard") &&
    !pathname.endsWith("/review") &&
    !pathname.endsWith("/artifacts")
  );
}
