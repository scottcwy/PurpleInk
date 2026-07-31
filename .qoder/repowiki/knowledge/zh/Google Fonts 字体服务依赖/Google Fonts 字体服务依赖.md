---
kind: external_dependency
name: Google Fonts 字体服务依赖
slug: google-fonts-geist
category: external_dependency
category_hints:
    - client_constraint
    - framework_behavior
scope:
    - '**'
---

### 项目中的 Google Fonts 依赖
- Next.js 应用通过 `next/font/google` 引入 Geist 字体，构建时从 `fonts.googleapis.com` 下载字体文件
- 这是被忽略的部署硬依赖：Dockerfile 的 build 阶段执行 `pnpm build`，镜像构建必须能出网访问 Google Fonts
- 当前网络环境下（如测试环境）该域名超时导致构建失败，需要打通出网或改用本地字体自托管
- 生产镜像中已预装 fonts-wqy-zenhei 作为 CJK 字体支持，但 Geist 仍需在线获取
- 建议改为本地自托管以符合「离线可重建」原则
- verify exact API/params against official docs: next/font 配置方式需参考官方文档