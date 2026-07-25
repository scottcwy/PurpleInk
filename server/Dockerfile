# PurpleInk 生产镜像（server/ worker）。
#
# 对应 docs/issues/ISSUE-015-production-issue.md §7、§9 P-6/P-7，
# docs/plans/PLAN-001-p2-p6-p7-production-deployment.md §3.6（一起部署 worker）。
#
# 重要：与根 Dockerfile 是两套独立系统（AGENTS.md §0 硬边界）——env 加载器、
# model routing、job 状态机不共用；本文件只是复用同一个 pnpm workspace 的
# `pnpm install` 结果（这不是"共用配置"，是 monorepo 依赖解析的必然要求：
# server/ 的依赖版本落在根 pnpm-lock.yaml 里，必须以仓库根为构建上下文）。
#
# 构建命令（在仓库根执行）：
#   docker build -f server/Dockerfile -t purpleink-worker .
#
# 基础镜像选型同根 Dockerfile：mcr.microsoft.com/playwright 系列 tag 在构建当下
# 实测 404，改走 node:22-bookworm-slim + playwright install --with-deps。

# ---------------------------------------------------------------------------
# deps：workspace 级 pnpm install。跳过浏览器下载，运行期再按需装 Chromium。
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# runtime：worker 走 tsx 直接跑 TS 源码（server/package.json 的 "start" 脚本），
# 不产出单独构建物。CJK 字体同样必须装（采集/截图链路也过 Playwright）。
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

# fonts-wqy-zenhei 而非 fonts-noto-cjk：见根 Dockerfile 同一处注释，本仓库构建
# 网络环境下 60.2MB 的 fonts-noto-cjk 单文件反复下载失败，换成 7.5MB 的
# fonts-wqy-zenhei（覆盖中文字形，本产品实际渲染的语言）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends -o Acquire::Retries=5 -o Acquire::http::Timeout=30 \
      ca-certificates \
      fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/server/node_modules ./server/node_modules
COPY --from=deps /repo/package.json ./package.json
COPY --from=deps /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY server ./server

RUN npx --yes playwright@"$(node -p "require('./server/node_modules/playwright/package.json').version")" install-deps chromium

RUN groupadd -r pwuser \
    && useradd -r -g pwuser -m -d /home/pwuser -s /usr/sbin/nologin pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright /repo/server/out /repo/server/capture \
    && chown -R pwuser:pwuser /ms-playwright /repo/server/out /repo/server/capture /repo

USER pwuser
RUN npx --yes playwright@"$(node -p "require('./server/node_modules/playwright/package.json').version")" install chromium

# server/src/compose/run-pipeline.ts 用相对路径 `../../../src/lib/tts/config`
# 直接引用根 src/ 的 TTS 配置解析（唯一一处跨目录引用，docs/configuration/tts.md
# 已说明该模块只依赖 zod、不含 server-only 哨兵），worker 镜像必须带上这份源码。
# 放在 Chromium 装完之后，避免 src/ 的高频变更让昂贵的浏览器下载层反复失效。
COPY --chown=pwuser:pwuser src ./src

ENV NODE_ENV=production
EXPOSE 8787
# 直接执行 tsx 的 shim（POSIX shell 脚本，#!/bin/sh 开头）本身，不要用
# `node node_modules/.bin/tsx ...` 包一层——那会把 shell 代码当 JS 解析报语法
# 错误，见根 Dockerfile 同一处注释。exec 形式直接给路径，内核按 shebang 处理。
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
