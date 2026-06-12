# HCCA Discord Bot

Discord Bot 是獨立服務，只透過 HTTPS internal API 與校園自治平台連線，不直接存取
PostgreSQL、Redis，也不需要和 API 位於同一台主機。

## API 主機

1. 將 FastAPI 的 `/internal/discord/*` 路徑透過公開 HTTPS 網域提供給 Bot 主機。
2. 設定 `ALLOWED_HOSTS` 包含 API 公開網域。
3. 在後台建立 scope 包含 `discord:bot` 的 API Key。
4. 防火牆可只允許 Bot 主機固定 IP 存取 `/internal/discord/*`。

連線狀態端點需要 API Key：

```bash
curl -H "X-API-Key: hcca_..." \
  https://api.example.edu.tw/internal/discord/status
```

## Bot 主機

Bot 主機只需要 Docker、可連線 Discord，以及可透過 HTTPS 連線 API。建立 `.env`：

```dotenv
HCCA_DISCORD_BOT_API_URL=https://api.example.edu.tw
HCCA_DISCORD_BOT_API_KEY=hcca_...
FRONTEND_BASE_URL=https://platform.example.edu.tw
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=
DISCORD_COMMAND_SYNC_GUILD_ID=
```

若 API 受 Cloudflare Access 保護，再加入 Service Token：

```dotenv
HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_ID=...
HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_SECRET=...
```

從專案根目錄啟動獨立 Bot：

```bash
docker compose -f docker-compose.bot.yml up -d --build
docker compose -f docker-compose.bot.yml logs -f discord-bot
```

Bot 每 20 秒回報一次 inventory 作為心跳。API 暫時中斷時，Discord 連線會保持運作，
Bot 會持續重試，恢復後自動重新連結，不需重啟。
