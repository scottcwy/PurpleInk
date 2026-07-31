# ISSUE-015 P-6 验收证据

## 0. 基础镜像选型结论

计划草稿推荐的选项 A（`mcr.microsoft.com/playwright:v1.62.0-noble` /
`:v1.62.0`）实测 `docker pull` 均返回 `not found`：

```text
$ docker pull mcr.microsoft.com/playwright:v1.62.0-noble
docker: Error response from daemon: failed to resolve reference
"mcr.microsoft.com/playwright:v1.62.0-noble": not found

$ docker pull mcr.microsoft.com/playwright:v1.62.0
docker: Error response from daemon: failed to resolve reference
"mcr.microsoft.com/playwright:v1.62.0": not found
```

改走选项 B：`node:22-bookworm-slim` + `playwright install-deps` +
`playwright install chromium`（两个 Dockerfile 均如此）。

## 1. `docker build` exit 0，镜像体积

```text
$ docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
purpleink-dev-worker          latest             5.13GB
purpleink-dev-next            latest             5.29GB
purpleink-dev-reverse-proxy   latest             82.9MB
```

（未启用 `output: 'standalone'`，整份 `node_modules` 进运行镜像，符合
PLAN-001 §2.4 首版推荐——体积大但零风险。）

## 2. 容器内 `node -v` 与钉死版本一致

```text
$ docker run --rm purpleink-dev-next node -v
v22.23.1
$ docker run --rm purpleink-dev-worker node -v
v22.23.1
```

满足 `package.json` 新增的 `engines.node: ">=22.11.0"`。

## 3. 容器内 Chromium 非 root、无 `--no-sandbox` 启动成功

```text
$ docker run --rm purpleink-dev-next id
uid=999(pwuser) gid=999(pwuser) groups=999(pwuser)

$ docker run --rm purpleink-dev-next node -e "
  const {chromium}=require('playwright');
  chromium.launch({headless:true}).then(async b=>{
    console.log('launch ok', await b.version()); await b.close();
  })"
launch ok 151.0.7922.34

$ docker run --rm purpleink-dev-worker id
uid=999(pwuser) gid=999(pwuser) groups=999(pwuser)

$ docker run --rm ... purpleink-dev-worker node -e "
  const {chromium}=require('./server/node_modules/playwright');
  chromium.launch({headless:true}).then(async b=>{
    console.log('worker launch ok', await b.version()); await b.close();
  })"
worker launch ok 151.0.7922.34
```

launch 命令没有传 `args: ['--no-sandbox']`，进程 uid 999（`pwuser`，非 0），
Chromium 沙箱按官方推荐的非 root 方案生效。

## 4. 容器内渲一帧，抽帧目视确认中文不是豆腐块

用 `playwright.chromium` 在容器内渲染一段中文 HTML 并截图，见同目录
`cjk-frame.png`：

> "PurpleInk 生产部署验证：中文渲染正常" —— 简体中文清晰渲染，非方块/豆腐块。

字体来源：`fonts-wqy-zenhei`（文泉驿正黑），而非计划草稿建议的
`fonts-noto-cjk`——后者单文件 60.2MB，在本仓库的构建网络环境下反复因大文件
长连接被中断下载失败（`Connection failed`，重试 5 次、超时 30s 仍失败）；
换成 7.5MB 的 `fonts-wqy-zenhei` 后稳定下载成功，且覆盖简繁中文字形，满足
本产品「不豆腐块」的实际要求（详见两个 Dockerfile 内注释）。

```text
$ docker run --rm purpleink-dev-next fc-list ':lang=zh'
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei,文泉驛正黑,文泉驿正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Sharp,...
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Mono,...
```

## 5. `ffmpeg-static` 二进制存在、可执行

```text
$ docker run --rm purpleink-dev-next node -e "console.log(require('ffmpeg-static'))"
/app/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg

$ docker run --rm purpleink-dev-next \
    /app/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg -version
ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/ ...
```

二进制在镜像内 `pnpm install`（deps stage，Linux 容器内执行）产生，不是从
Windows 宿主 `COPY` 进来的（`.dockerignore` 已排除 `node_modules`，机制上
避免误拷）。

## 6. `output: 'standalone'`

未启用，采用 PLAN-001 §2.4 首版推荐路径。

## 7. 构建期真实 bug 修复（连带发现，非 P-6 计划内条目）

构建过程中暴露两个此前未被发现的问题，均已按最小改动修复：

1. **`@next/env` 缺失直接依赖声明**：`scripts/setup/db-migrate.ts` /
   `bootstrap-credentials.ts` / `scripts/verify/e2e-smoke.ts` 三处直接
   `import('@next/env')`，但根 `package.json` 未声明该依赖，只是靠宿主机
   历史遗留的 node_modules 意外可解析。全新 `pnpm install --frozen-lockfile`
   （Docker 构建必经路径）复现了 `next build` 的
   `Type error: Cannot find module '@next/env'`。已用
   `pnpm add -w @next/env@^16.2.0` 补上直接依赖声明。
2. **`node_modules/.bin/next` / `.bin/tsx` 是 POSIX shell shim**（`#!/bin/sh`
   开头），`node node_modules/.bin/next start` 会把 shell 代码当 JS 解析报
   `SyntaxError: missing ) after argument list`。两个 Dockerfile 的 `CMD`
   均已改为直接执行入口（`node node_modules/next/dist/bin/next start`；
   `node_modules/.bin/tsx ...` 以可执行文件形式直接调用，让内核按 shebang
   处理）。
3. **worker 跨目录引用根 `src/`**：`server/src/compose/run-pipeline.ts` 用
   相对路径 `../../../src/lib/tts/config` 引用根目录的 TTS 配置解析（全
   `server/src/**` 唯一一处跨目录引用）。`server/Dockerfile` 原本只 `COPY
   server ./server`，缺这份源码导致 `ERR_MODULE_NOT_FOUND`。已补
   `COPY --chown=pwuser:pwuser src ./src`（放在 Chromium 安装步骤之后，
   避免 `src/` 的高频变更让昂贵的浏览器下载层反复失效）。
