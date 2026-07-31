---
kind: external_dependency
name: Playwright 浏览器自动化
slug: playwright
category: external_dependency
scope:
    - '**'
---

### Playwright 浏览器自动化工具
- 用于网页截图、内容采集和渲染测试
- 在 Dockerfile 中通过 playwright install-deps chromium 安装系统依赖
- Chromium 二进制以非 root 用户 pwuser 运行，无 --no-sandbox 参数
- 浏览器版本与 node_modules 中实际安装的 playwright 版本对齐
- 支持 BROWSER_DRIVER 环境变量切换驱动类型
- 需要 CJK 字体支持中文渲染