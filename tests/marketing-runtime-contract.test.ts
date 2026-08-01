import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

describe("marketing production runtime contract", () => {
  it("uses self-hosted Geist fonts without a build-time Google Fonts request", () => {
    const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as PackageManifest;

    expect(packageJson.dependencies?.geist).toBe("1.7.2");
    expect(layoutSource).toContain('from "geist/font/sans"');
    expect(layoutSource).toContain('from "geist/font/mono"');
    expect(layoutSource).not.toContain('from "next/font/google"');
  });

  it("traces only Playwright's dynamically loaded browser manifest", async () => {
    const { default: nextConfig } = await import("../next.config");
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as PackageManifest;

    expect(packageJson.dependencies?.playwright).toBe("1.62.0");
    expect(packageJson.dependencies?.["playwright-core"]).toBe("1.62.0");
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(["playwright", "playwright-core"])
    );
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/*": [
        "./node_modules/playwright-core/browsers.json",
        "./assets/fonts/**/*",
      ],
    });
    expect(nextConfig.outputFileTracingExcludes).toHaveProperty("/*");
    expect(JSON.stringify(nextConfig.outputFileTracingIncludes)).not.toContain(
      "playwright/**/*"
    );
    expect(JSON.stringify(nextConfig.outputFileTracingIncludes)).not.toContain(
      "playwright-core/**/*"
    );
    expect(packageJson.scripts?.build).toBe("next build --webpack");
  });
});
