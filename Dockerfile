# PurpleInk 生产镜像（Next 应用）。
#
# 对应 docs/issues/ISSUE-015-production-issue.md §9 P-6、
# docs/plans/PLAN-001-p2-p6-p7-production-deployment.md §2。
#
# 基础镜像选型（§2.2 选项 B）：mcr.microsoft.com/playwright:v1.62.0-noble /
# :v1.62.0 两个 tag 在构建当下均 404（已实测 `docker pull` 失败，见
# docs/deployment/runbook.md §2），故不采用「官方 Playwright 镜像」这条路，
# 改走 `node:22-bookworm-slim` + `playwright install --with-deps chromium`，
# 浏览器版本按 node_modules 里实际安装的 playwright 版本对齐（§2.1 第二条）。
#
# Web 运行层只接收 Next standalone 闭包、静态资源、字体与 Linux Chromium。
# migrate 保持独立 target，保留 tsx 与迁移源码，不与 Web 运行层混装。

# ---------------------------------------------------------------------------
# deps：在 Linux 镜像内跑 pnpm install，让 ffmpeg-static 的 postinstall
# 下载 Linux 平台二进制；绝不能从 Windows 宿主 COPY node_modules。
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 跳过此阶段的浏览器下载——deps/build/migrate
# 都不需要真的启动 Chromium，浏览器二进制只在 runtime 阶段按需装。
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY patches patches
COPY server/package.json server/package.json
COPY packages/procedural-sfx/package.json packages/procedural-sfx/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build：next build（NODE_ENV=production，触发 next.config.ts 的 removeConsole
# exclude: ['error','warn'] 分支，ISSUE-015 P-1 已验证）。
# instrumentation.register() 有 NEXT_PHASE === 'phase-production-build' 守卫，
# 构建期不连 DB（src/lib/db/client.ts 是惰性连接，模块 import 不触发连接）。
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo
COPY . .
ARG BACKEND_ORIGIN=http://worker:8787
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}
ENV NODE_ENV=production
RUN pnpm build

# ---------------------------------------------------------------------------
# migrate：保留 devDependencies（tsx / drizzle-kit），供一次性迁移任务使用。
# 迁移文件路径由 src/lib/db/migrate.ts 用 process.cwd() 拼出，因此 WORKDIR
# 必须是仓库根、且需要完整 src/lib/db/migrations/pg。
# ---------------------------------------------------------------------------
FROM deps AS migrate
WORKDIR /repo
COPY tsconfig.json ./tsconfig.json
COPY scripts/setup/db-migrate.ts ./scripts/setup/db-migrate.ts
COPY src/lib/db/migrate.ts ./src/lib/db/migrate.ts
COPY src/lib/db/schema ./src/lib/db/schema
COPY src/lib/db/migrations/pg ./src/lib/db/migrations/pg
ENTRYPOINT ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
# runtime：安装 CJK 字体（§3.3 第 3 点）+ Chromium，非 root 运行（§3.3 第 1 点，
# Playwright 官方 pwuser 模式；不加 --no-sandbox——加载模型生成的 HTML，沙箱是
# 有意义的防线）。
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# fonts-wqy-zenhei 而非 fonts-noto-cjk：实测 fonts-noto-cjk 单文件 60.2MB，
# 在本仓库的构建网络环境下反复因大文件长连接被中断下载失败（Connection
# failed），换成 7.5MB 的 fonts-wqy-zenhei 稳定下载成功；本产品渲染的是中文
# 内容（见 AGENTS.md），文泉驿正黑覆盖简繁中文字形，满足「不豆腐块」要求。
RUN apt-get update \
    && apt-get install -y --no-install-recommends -o Acquire::Retries=5 -o Acquire::http::Timeout=30 \
      ca-certificates \
      fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/.next/standalone ./
COPY --from=build /repo/.next/static ./.next/static
COPY --from=build /repo/public ./public
COPY --from=deps /repo/node_modules /playwright/node_modules
# assets/fonts 是硬字幕烧录的字体真值：concat.ts 按 process.cwd() 拼出 assets/fonts
# 并传给 ffmpeg 的 ass 滤镜 fontsdir。漏掉这一层 COPY，导出会因缺字体直接失败
# （故意不静默回退——回退会产出中英分属两个 face 的混排字幕且无任何报错）。
COPY --from=build /repo/assets ./assets

# Chromium 系统依赖（需要 root 装 apt 包）与浏览器二进制分两步：
# install-deps 装系统库；浏览器二进制下载到非 root 用户可写的共享目录。
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' \
      > /etc/apt/apt.conf.d/80purpleink-retries \
    && node /playwright/node_modules/playwright/cli.js install-deps chromium

RUN groupadd -r pwuser \
    && useradd -r -g pwuser -m -d /home/pwuser -s /usr/sbin/nologin pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright /app/.data \
    && chown -R pwuser:pwuser /ms-playwright /app/.data /app

USER pwuser
RUN node /playwright/node_modules/playwright/cli.js install chromium

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
