import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;

  // TODO(share-snapshot): /artifacts 与每个 featured 案例待 ShareSnapshot 落盘后接入。
  // 见 docs/conventions/routing.md §3 与 §8。不得在数据源存在前编造条目（AGENTS.md §6）。
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/community`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
