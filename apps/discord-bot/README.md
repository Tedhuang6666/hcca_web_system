# HCCA Discord Bot

Discord Bot 是獨立服務，只透過 HTTPS internal API 與校園自治平台連線，不直接存取
PostgreSQL、Redis，也不需要和 API 位於同一台主機。

## API 主機

正式環境的 `deploy/Caddyfile` 已將 `/internal/discord/*` 轉發到 FastAPI；該路徑仍由
`X-API-Key` 加上 `discord:bot` scope 保護。部署 API / proxy 後測試：

```bash
curl -i https://api.example.edu.tw/internal/discord/status \
  -H "X-API-Key: hcca_..."
```

應回傳 `200`。在後台 `/admin/api-keys` 建立專用 key，scope 填 `discord:bot`，明文只
會顯示一次；Bot 主機固定 IP 也可以在防火牆或 Cloudflare Access 進一步限制。

## Bot 主機

Bot 主機只需要 Docker、可連線 Discord，以及可透過 HTTPS 連線 API。複製
`apps/discord-bot/env.example` 為 `.env.discord-bot`，填入：

```dotenv
HCCA_DISCORD_BOT_API_URL=https://api.example.edu.tw
HCCA_DISCORD_BOT_API_KEY=hcca_...
FRONTEND_BASE_URL=https://platform.example.edu.tw
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=
DISCORD_COMMAND_SYNC_GUILD_ID=
```

若 API 受 Cloudflare Access 保護，再加入：

```dotenv
HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_ID=...
HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_SECRET=...
```

從專案根目錄啟動獨立 Bot：

```bash
docker compose --env-file .env.discord-bot -f docker-compose.bot.yml up -d --build
docker compose --env-file .env.discord-bot -f docker-compose.bot.yml logs -f discord-bot
```

Bot 每 20 秒回報一次 inventory 作為心跳。API 暫時中斷時，Discord 連線會保持運作，
Bot 會持續重試，恢復後自動重新連結，不需重啟。

## Discord Developer Portal

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application，
   在 **Bot** 頁面建立 Bot 並保存 Token。
2. 開啟 **Server Members Intent** 與 **Message Content Intent**；本程式需要成員事件及
   訊息內容。若應用程式已驗證，Privileged Intents 也要完成 Discord 核准。
3. 在 **Installation / OAuth2** 產生安裝連結，至少選 `bot` 與 `applications.commands`。
   只給必要權限，例如 View Channels、Send Messages、Embed Links、Manage Roles、
   Manage Channels；不要直接給 Administrator，且 Bot 最高角色要高於要同步的角色。
4. 將 Bot 加入目標伺服器。取得伺服器 ID 填入 `DISCORD_GUILD_ID`；開發時填
   `DISCORD_COMMAND_SYNC_GUILD_ID` 可立即同步 slash commands。

## API 檢查與輪替

在前端 `/admin/api-keys` 建立專用 API key，scope 僅填 `discord:bot`，明文只顯示一次。
用下列命令驗證外部路由：

```bash
curl -i https://api.example.edu.tw/internal/discord/status \
  -H 'X-API-Key: hcca_...'
```

`200` 代表 API、Caddy 和 key 都正常；`401` 是 key 無效/過期，`403` 是 scope 不正確，
`404` 通常表示 Caddy 尚未部署 `/internal/discord/*` 路由。key 洩漏時，先在
`/admin/api-keys` 撤銷，再建立新 key、更新 Bot 主機的 `.env.discord-bot` 並重啟：

```bash
docker compose --env-file .env.discord-bot -f docker-compose.bot.yml up -d --build
```

API 主機正式部署命令：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --build api proxy
```
