import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 允许取证/端测用独立构建目录，避免与正在运行的 dev server 争用 .next。
  // 不设置时行为与以往完全一致。
  ...(process.env.CVC_NEXT_DIST_DIR
    ? { distDir: process.env.CVC_NEXT_DIST_DIR }
    : {}),
  // Pin turbopack root so the empty lockfile in the parent YE/ dir isn't picked up
  turbopack: {
    root: process.cwd(),
  },
  // pi-ai/pi-agent-core 的 dist 内含动态 require（provider 懒加载），
  // 被 Turbopack 打包后抛 MODULE_NOT_FOUND（"expression is too dynamic"），
  // 导致 Director 全部阶段的模型调用失败；保持外部化走原生 Node 解析。
  serverExternalPackages: [
    "ffmpeg-static",
    "postgres",
    "drizzle-orm",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "playwright",
    "playwright-core",
  ],
  // Playwright Core 通过动态 path.join 加载 browsers.json；其余 runtime
  // 由正常的模块依赖追踪收集，禁止 broad glob 把整个仓库复制进 standalone。
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/playwright-core/browsers.json",
      "./assets/fonts/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./AGENTS.md",
      "./README.md",
      "./PRD_PurpleInk.md",
      "./docs/**/*",
      "./scripts/**/*",
      "./src/**/*",
      "./tests/**/*",
    ],
  },
  // Disable source maps in production to protect code
  productionBrowserSourceMaps: false,
  // 生产构建移除 console.log，但**必须保留 error / warn**：
  // 服务端刻意不把 provider 原始错误暴露给用户（AGENTS.md §6），分类后的诊断信息
  // 只经 console.error 落到服务端日志。若一并移除，生产环境节点 failed 时容器日志
  // 里将没有任何可归因信息（实测：布尔 true 时 `[director] 模型调用失败`、
  // `[render] 下游自动推进失败` 等字符串在 285 个 server chunk 中零命中）。
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  // 前端一律打同源 /api/*，由 Next 反向代理到渲染 worker（server/）。
  // 好处：浏览器无跨域；生产环境单域名部署，worker 不对外暴露（走内网 BACKEND_ORIGIN）。
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN || "http://localhost:8787";
    return [{ source: "/api/engine/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
