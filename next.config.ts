import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
  ],
  // Disable source maps in production to protect code
  productionBrowserSourceMaps: false,
  // Remove console.log in production
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
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
