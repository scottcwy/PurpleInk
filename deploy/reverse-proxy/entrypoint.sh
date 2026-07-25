#!/bin/sh
# 从 compose secret 文件读取 Basic Auth 凭据注入环境变量，再启动 Caddy。
# 文件格式（单行）："<用户名> <bcrypt 哈希>"，由
# `docker run --rm caddy:2-alpine caddy hash-password --plaintext '<口令>'` 生成哈希后
# 手工拼成一行，写入 deploy/reverse-proxy/secrets/basic_auth_credentials（已 gitignore，
# 不提交仓库、不进镜像层——该文件只在运行期经 compose `secrets:` 挂载到
# /run/secrets/basic_auth_credentials）。
set -eu

CREDENTIALS_FILE="/run/secrets/basic_auth_credentials"

if [ -f "$CREDENTIALS_FILE" ]; then
	CVC_BASIC_AUTH_USER="$(awk '{print $1}' "$CREDENTIALS_FILE")"
	CVC_BASIC_AUTH_HASH="$(awk '{print $2}' "$CREDENTIALS_FILE")"
	export CVC_BASIC_AUTH_USER CVC_BASIC_AUTH_HASH
else
	echo "[reverse-proxy] 致命错误：缺少 $CREDENTIALS_FILE，拒绝以无认证状态启动" >&2
	exit 1
fi

: "${CVC_ALLOWED_CIDRS:=0.0.0.0/0 ::/0}"
export CVC_ALLOWED_CIDRS

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
