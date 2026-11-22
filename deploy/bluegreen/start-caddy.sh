#!/bin/sh
set -eu

state_file=/etc/caddy/state/active-slot
slot=""
if [ -r "$state_file" ]; then
  slot="$(tr -d '[:space:]' < "$state_file")"
fi

case "$slot" in
  blue|green)
    config="/etc/caddy/bluegreen/Caddyfile.$slot"
    ;;
  *)
    # 第一次部署或 active slot 不明時，先提供靜態維護頁，避免誤指向已停止的 slot。
    config="/etc/caddy/bluegreen/Caddyfile.maintenance"
    ;;
esac

exec caddy run --config "$config" --adapter caddyfile
