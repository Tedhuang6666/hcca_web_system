#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.bot.yml"
ENV_FILE="${HCCA_DISCORD_BOT_ENV_FILE:-}"

if [[ -z "$ENV_FILE" ]]; then
    if [[ -f "$SCRIPT_DIR/.env.discord-bot" ]]; then
        ENV_FILE="$SCRIPT_DIR/.env.discord-bot"
    elif [[ -f "$PROJECT_ROOT/.env.discord-bot" ]]; then
        ENV_FILE="$PROJECT_ROOT/.env.discord-bot"
    else
        ENV_FILE="$SCRIPT_DIR/env.example"
        echo "警告：目前使用 env.example；正式環境建議複製為 .env.discord-bot，避免憑證進入 Git。" >&2
    fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "找不到設定檔：$ENV_FILE" >&2
    echo "請設定 HCCA_DISCORD_BOT_ENV_FILE，或建立 $SCRIPT_DIR/.env.discord-bot" >&2
    exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "找不到 Compose 檔案：$COMPOSE_FILE" >&2
    exit 1
fi

compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! command -v docker >/dev/null 2>&1; then
    echo "找不到 docker，請先安裝 Docker。" >&2
    exit 1
fi

echo "使用設定檔：$ENV_FILE"
echo "檢查 Docker Compose 設定……"
compose config --quiet

echo "檢查 HCCA API 連線……"
compose run --rm discord-bot python -m hcca_discord_bot --check-api

echo "建置並啟動 Discord Bot……"
compose up -d --build discord-bot

echo "Discord Bot 已啟動。查看日誌："
echo "  $(printf '%q' "$0") logs"

if [[ "${1:-}" == "logs" ]]; then
    compose logs -f discord-bot
elif [[ "${1:-}" == "status" ]]; then
    compose ps discord-bot
fi
