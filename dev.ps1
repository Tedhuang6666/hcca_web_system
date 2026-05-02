# =============================================================================
# dev.ps1 — 智慧型自動化開發環境啟動腳本 (語法修正版)
# =============================================================================
$ErrorActionPreference = "Stop"

# ── 函式：檢查並釋放 Port ────────────────────────────────────────────────────
function Start-PortGuardian($Port) {
    $item = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($item) {
        Write-Host "[WARN] Port $Port 已被占用 (PID: $($item.OwningProcess))，正在強制釋放..." -ForegroundColor Yellow
        Stop-Process -Id $item.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# ── 1. 初始化與環境檢查 ──────────────────────────────────────────────────────
Write-Host "--- [Step 1] 環境初始化 ---" -ForegroundColor Cyan
$EnvFile = "$PSScriptRoot\.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } | ForEach-Object {
        $parts = $_.Split('=', 2)
        if ($parts.Length -eq 2) {
            [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
        }
    }
    Write-Host "[OK] 環境變數載入完成" -ForegroundColor Green
}

# ── 2. 基礎設施守護 (Docker) ─────────────────────────────────────────────────
Write-Host "`n--- [Step 2] 檢查 Docker 基礎設施 ---" -ForegroundColor Cyan
try {
    docker compose -f "$PSScriptRoot\docker-compose.yml" up -d db redis
} catch {
    Write-Host "[ERR] Docker 啟動失敗，請確認 Docker Desktop 是否已開啟" -ForegroundColor Red
    exit
}

# ── 3. 後端依賴與 Migration ──────────────────────────────────────────────────
Write-Host "`n--- [Step 3] 同步 Python 依賴與資料庫 ---" -ForegroundColor Cyan
Set-Location $PSScriptRoot
uv sync

$AlembicDir = if (Test-Path "$PSScriptRoot\apps\api\alembic.ini") { "$PSScriptRoot\apps\api" } else { $PSScriptRoot }
Push-Location $AlembicDir
Write-Host "[INFO] 執行 Alembic Migration..." -ForegroundColor Gray
uv run alembic upgrade head
Pop-Location

# ── 4. 前端健康檢查 (確保 if-else 區塊完整) ───────────────────────────────────
Write-Host "`n--- [Step 4] 前端依賴健康檢查 ---" -ForegroundColor Cyan
$WebDir = "$PSScriptRoot\apps\web"
$NextBin = "$WebDir\node_modules\next"

if (-not (Test-Path $NextBin)) {
    Write-Host "[!] 偵測到前端依賴缺失，啟動自動修復 (npm install)..." -ForegroundColor Yellow
    Push-Location $WebDir
    # 如果 node_modules 存在但內容不全，先刪除再裝
    if (Test-Path "node_modules") { 
        Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue 
    }
    npm install
    Pop-Location
} else {
    Write-Host "[OK] 前端依賴檢查正常" -ForegroundColor Green
}

# ── 5. 衝突排除與啟動服務 ────────────────────────────────────────────────────
Write-Host "`n--- [Step 5] 啟動開發服務 ---" -ForegroundColor Cyan

# 釋放潛在占用的 Port
Start-PortGuardian 8000
Start-PortGuardian 3000

# 啟動後端
Write-Host "[API] 正在彈出後端視窗..." -ForegroundColor Gray
Start-Process cmd -ArgumentList "/k title BACKEND-API && uv run uvicorn api:app --host 0.0.0.0 --port 8000 --reload --reload-dir apps/api/src --app-dir apps/api/src" -WorkingDirectory $PSScriptRoot

# 啟動前端
Write-Host "[WEB] 正在彈出前端視窗..." -ForegroundColor Gray
Start-Process cmd -ArgumentList "/k title FRONTEND-WEB && npm run dev" -WorkingDirectory $WebDir

# ── 完成彙整 ──────────────────────────────────────────────────────────────────
Set-Location $PSScriptRoot
Write-Host "`n════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host " 🚀 開發環境啟動程序已完成！" -ForegroundColor Green
Write-Host " --------------------------------------------------"
Write-Host " 🍎 前端介面 : http://localhost:3000" -ForegroundColor Cyan
Write-Host " 🐍 API 文件 : http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Green