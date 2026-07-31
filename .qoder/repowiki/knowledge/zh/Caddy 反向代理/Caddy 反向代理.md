---
kind: external_dependency
name: Caddy 反向代理
slug: caddy
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Caddy 反向代理服务
- 作为唯一的 443 端口入口，提供 TLS 终止、IP 过滤和 Basic Auth
- 配置文件位于 deploy/reverse-proxy/Caddyfile
- 需要 basic_auth_credentials secret 文件才能启动
- 证书和数据存储在 cvc_caddy_data 和 cvc_caddy_config 卷中
- 依赖 Next 应用健康检查通过后才会启动