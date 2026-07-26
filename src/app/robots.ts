import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      // `/products/` 与 `/login` 一族是登录后 / 登录中的表面，没有获客价值，
      // 且 URL 里带内部 projectId。metadata 侧已 noIndex，这里再拦一道
      // （PLAN-002 §4.6；routing.md §1 的可索引列）。
      disallow: [
        "/api/",
        "/private/",
        "/share/",
        "/products/",
        "/login",
        "/signup",
        "/password/",
      ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
