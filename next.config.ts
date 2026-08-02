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
  // Playwright dynamically loads browsers.json and server bundles. Next's
  // standalone tracer cannot discover all of those files from static imports.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
  // Turbopack 对仓库根的动态文件访问无法静态裁剪，会把整个仓库 trace 进
  // standalone（实测 277M：videos/51M、docs/9.6M、deploy 凭据文件全在）。
  // 白名单排除已知非运行时目录；assets/ 不走 trace，由 Dockerfile 源 COPY
  // （硬字幕字体真值，语义更明确）。
  // 注意：excludes 只对路由 entry 的 nft 生效（collect-build-traces 按
  // entryNameFilesMap 应用），instrumentation 等非路由入口不受控——其残留由
  // scripts/verify/standalone-hygiene.mjs --prune 在镜像构建期物理清理，
  // Dockerfile.web 白名单 COPY 兜底镜像边界。
  // 另外 glob 是 contains 语义：不能排除 "./server/**/*"——它会把运行时必需的
  // .next/server/chunks/ssr 误删（实测 page nft 80 条 ssr 引用被清空，
  // standalone 缺 ssr chunk，所有页面 500）。仓库根 server/ 由 prune 兜底。
  outputFileTracingExcludes: {
    "/*": [
      "./videos/**/*",
      "./docs/**/*",
      "./tests/**/*",
      "./scripts/**/*",
      "./deploy/**/*",
      "./output/**/*",
      "./patches/**/*",
      "./config/**/*",
      "./assets/**/*",
      "./*.md",
      "./Dockerfile*",
      "./docker-compose*.yml",
      "./*.config.*",
      "./tsconfig.json",
      "./vitest*",
      "./pnpm-workspace.yaml",
      "./pnpm-lock.yaml",
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
};

export default nextConfig;
