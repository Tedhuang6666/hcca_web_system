#!/usr/bin/env bash
# 等 GitHub Actions 把「指定 commit」的映像建好並推上 GHCR。
# 用法: ./scripts/wait-ghcr-image.sh <git-sha> [timeout_sec]
#
# docker.yml 只在 CI 成功後發布不可變的 :<sha> tag。兩個 manifest 都查得到，才代表
# 指定 commit 已通過 CI 且映像可部署；compose 會明確拉取該 SHA，不使用 mutable latest。
set -uo pipefail

sha="${1:?用法: wait-ghcr-image.sh <git-sha> [timeout_sec]}"
# 映像只在 CI 通過後建置（CI 約 8–12 分鐘＋建置約 4 分鐘），預設最多等 30 分鐘。
timeout="${2:-${GHCR_IMAGE_WAIT_SECONDS:-1800}}"
api="ghcr.io/tedhuang6666/hcca_web_system-api:${sha}"
preview="ghcr.io/tedhuang6666/hcca_web_system-petition-preview:${sha}"
web="ghcr.io/tedhuang6666/hcca_web_system-web:${sha}"

deadline=$(( $(date +%s) + timeout ))
printf '等 CI 映像建好（最多 %ss）:\n  %s\n  %s\n  %s\n' "$timeout" "$api" "$preview" "$web"
while :; do
  if docker manifest inspect "$api" >/dev/null 2>&1 \
     && docker manifest inspect "$preview" >/dev/null 2>&1 \
     && docker manifest inspect "$web" >/dev/null 2>&1; then
    echo "三個映像都就緒 ✓"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "逾時 ${timeout}s 仍未就緒，放棄等待（CI 可能還在跑或失敗了）" >&2
    exit 1
  fi
  printf '.'; sleep 15
done
