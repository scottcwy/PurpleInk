import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageRoutes = [
  "admin",
  "admin/jobs",
  "admin/ops",
  "admin/security",
  "admin/ai",
];
const apiRoutes = ["jobs", "ops", "security", "ai"];

describe("admin operational route contracts", () => {
  it.each(pageRoutes)(
    "protects /%s with the database-backed admin guard",
    (route) => {
      const source = readFileSync(
        resolve("src/app", route, "page.tsx"),
        "utf8"
      );
      expect(source).toContain("requireAdminSession");
      expect(source).not.toContain("render_jobs");
    }
  );

  it.each(apiRoutes)(
    "protects /api/admin/%s with an isolated route group",
    (route) => {
      const source = readFileSync(
        resolve("src/app/api/admin", route, "route.ts"),
        "utf8"
      );
      expect(source).toContain("withAdminSession");
      expect(source).toMatch(new RegExp(`routeGroup: ["']admin-${route}["']`));
      expect(source).not.toContain("render_jobs");
    }
  );

  it("keeps the registered DAU and job-detail API shapes", () => {
    const dau = readFileSync(
      resolve("src/app/api/admin/metrics/dau/route.ts"),
      "utf8"
    );
    const detail = readFileSync(
      resolve("src/app/api/admin/jobs/[id]/route.ts"),
      "utf8"
    );
    expect(dau).toContain("withAdminSession");
    expect(dau).toMatch(/routeGroup: ["']admin-metrics-dau["']/);
    expect(detail).toContain("withAdminSession");
    expect(detail).toMatch(/routeGroup: ["']admin-jobs-detail["']/);
    expect(detail).toContain("status: 404");
    expect(detail).not.toContain("render_jobs");
  });

  it("keeps layout auth-only and uses a page frame without a second shell mapping", () => {
    const layout = readFileSync(resolve("src/app/admin/layout.tsx"), "utf8");
    const frame = readFileSync(
      resolve("src/features/admin/ui/admin-page-frame.tsx"),
      "utf8"
    );
    expect(layout).toContain("requireAdminSession");
    expect(layout).not.toContain("AdminShell");
    expect(layout).not.toContain("AdminPageFrame");
    expect(frame).not.toContain("AppSidebar");
    expect(frame).not.toContain("usePathname");
    expect(frame).not.toContain("active:");
    expect(existsSync(resolve("src/features/admin/ui/admin-shell.tsx"))).toBe(
      false
    );
  });
});
