import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin turbopack root so the empty lockfile in the parent YE/ dir isn't picked up
  turbopack: {
    root: process.cwd(),
  },
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
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
