import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnwiredPanel } from "@/app/_components/unwired-panel";

/** docs/conventions/routing.md §2 的路由表。改路由必须先改文档，再改这里。 */
const ROUTE_FILES = [
  // L1 公开
  "src/app/(marketing)/layout.tsx",
  "src/app/(marketing)/page.tsx",
  "src/app/(marketing)/community/page.tsx",
  "src/app/(public)/layout.tsx",
  "src/app/(public)/release/page.tsx",
  // L2 认证
  "src/app/(auth)/layout.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/signup/page.tsx",
  "src/app/(auth)/password/reset/page.tsx",
  // L3 制作应用
  "src/app/products/page.tsx",
  "src/app/products/(app)/layout.tsx",
  "src/app/products/(app)/dashboard/page.tsx",
  "src/app/products/(app)/projects/page.tsx",
  "src/app/products/(app)/canvas/[projectId]/page.tsx",
  "src/app/products/(app)/shots/[shotId]/page.tsx",
  "src/app/products/(app)/export/[projectId]/page.tsx",
  "src/app/products/(app)/settings/page.tsx",
  // L4 内部
  "src/app/playbook/page.tsx",
  // 错误与未找到边界
  "src/app/not-found.tsx",
  "src/app/global-error.tsx",
  "src/app/products/(app)/not-found.tsx",
  "src/app/products/(app)/error.tsx",
  // 元数据路由
  "src/app/robots.ts",
  "src/app/sitemap.ts",
] as const;

/** 已收敛的历史路由与并行壳，不允许回归。 */
const RETIRED_PATHS = [
  "src/app/legacy",
  "src/app/(product)",
  "src/app/(product)/releases",
  "src/app/(product)/_components/product-app-shell.tsx",
  "src/app/(product)/_components/product-sidebar.tsx",
  "src/app/(product)/_components/release-step-nav.tsx",
  "src/app/(product)/_components/product-page-header.tsx",
  "src/app/dashboard",
  "src/app/products/[productId]",
  "src/app/releases",
  "src/app/playbook/patterns",
  "src/features/workflow",
] as const;

describe("src/app 路由契约", () => {
  it("落盘规范里的每一条路由", () => {
    expect(ROUTE_FILES.filter((file) => !existsSync(file))).toEqual([]);
  });

  it("不保留已收敛的历史路由与并行壳", () => {
    expect(RETIRED_PATHS.filter((path) => existsSync(path))).toEqual([]);
  });

  it("制作应用只有一套壳与一套 pathname 映射", () => {
    const shellSource = readFileSync(
      "src/features/navigation/app-shell.tsx",
      "utf8"
    );
    const sidebarSource = readFileSync(
      "src/features/navigation/app-sidebar.tsx",
      "utf8"
    );
    const layoutSource = readFileSync(
      "src/app/products/(app)/layout.tsx",
      "utf8"
    );

    expect(shellSource).toContain("ds-app-gradient");
    // 合同不变：制作应用只有这一处挂 AppShell；允许带 props（如 account 会话投影）。
    expect(layoutSource).toMatch(/<AppShell[\s>]/);
    expect(sidebarSource).toContain("@/components/ui/sidebar");
    expect(sidebarSource).toContain("<PurpleInkSidebar");
    expect(sidebarSource).not.toContain("LegacySidebar");
    for (const label of ["工作台", "项目", "画布", "镜头", "导出"]) {
      expect(sidebarSource).toMatch(new RegExp(`label:\\s*["']${label}["']`));
    }
  });

  it("认证与公开层不挂应用侧栏", () => {
    for (const file of [
      "src/app/(auth)/layout.tsx",
      "src/app/(public)/layout.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("from '@/features/navigation");
      expect(source).not.toMatch(/<\w*(AppShell|Sidebar)\b/);
    }
  });

  it("只有营销路由组挂平滑滚动 Provider", () => {
    const marketingLayout = readFileSync(
      "src/app/(marketing)/layout.tsx",
      "utf8"
    );
    expect(marketingLayout).toContain("@/components/marketing/providers");

    for (const file of [
      "src/app/(auth)/layout.tsx",
      "src/app/(public)/layout.tsx",
      "src/app/products/(app)/layout.tsx",
      "src/app/playbook/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("@/components/marketing/providers");
      expect(source).not.toContain("SmoothScroll");
    }
  });

  it("应用源码里不留可执行的历史链接", () => {
    const sources = ROUTE_FILES.filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(sources).not.toContain("/legacy");
    expect(sources).not.toContain("/releases/");
  });

  it("Community 导航与可索引页面使用同一路由", () => {
    const headerSource = readFileSync(
      "src/components/marketing/header.tsx",
      "utf8"
    );
    const footerSource = readFileSync(
      "src/components/marketing/footer.tsx",
      "utf8"
    );
    const sitemapSource = readFileSync("src/app/sitemap.ts", "utf8");

    expect(headerSource).toContain('href: "/community"');
    expect(footerSource).toContain('label: "Community", href: "/community"');
    expect(sitemapSource).toContain("url: `${baseUrl}/community`");
  });

  it("Playbook 与应用复用同一个 Canonical 侧栏", () => {
    const sidebarDemo = readFileSync(
      "src/components/ui/sidebar.demo.tsx",
      "utf8"
    );

    expect(sidebarDemo).toContain("<PurpleInkSidebar");
    expect(sidebarDemo).not.toContain("CodeVideoCanvas");
  });

  it("未接线占位只声明边界与未来数据来源", () => {
    const html = renderToStaticMarkup(
      createElement(UnwiredPanel, {
        title: "发布",
        description: "未来在这里组织发布内容。",
        sources: ["Product", "Release"],
        futureGuard: "需要先完成认证。",
      })
    );

    expect(html).toContain("该页尚未接线");
    expect(html).toContain("Product");
    expect(html).toContain("Release");
    expect(html).toContain("未来进入前置");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("审批通过");
    expect(html).not.toContain("Stage B");
  });

  it("站点身份是 PurpleInk 而不是历史模板", () => {
    const metadataSource = readFileSync("src/lib/metadata.ts", "utf8");

    expect(metadataSource).toContain('name: "PurpleInk"');
    expect(metadataSource).not.toContain("React Bits Pro");
    expect(metadataSource).not.toContain("nexus-ai.com");
  });
});
