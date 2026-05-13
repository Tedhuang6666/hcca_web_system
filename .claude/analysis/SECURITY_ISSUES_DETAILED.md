# 安全性問題詳細報告

**生成日期**：2026-05-07  
**最新修復狀態**：請以 [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) 為準（最後核對：2026-05-13）  
**危險級別分佈**：🔴 4 個 CRITICAL | 🟠 6 個 HIGH | 🟡 7 個 MEDIUM | 🟢 3 個 LOW

---

## 🔴 CRITICAL 問題（立即修復，24 小時內）

### 1. 敏感認證信息洩露

**位置**：`.env` 檔案（根目錄）

**問題內容**：
```bash
GOOGLE_CLIENT_SECRET=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  # ❌ 實際祕密已暴露
MAIL_PASSWORD=your-gmail-app-password  # 佔位符但未安全存儲
```

**危害**：
- 攻擊者可冒充 Google 帳號，進行 OAuth2 攔截、會話劫持
- 郵件服務可被盜用，發送釣魚郵件

**修復方案**：
```bash
# Step 1：立即重設 Google OAuth2 祕密
# 1. 訪問 Google Cloud Console
# 2. 刪除舊的 OAuth2 Client ID
# 3. 建立新的 Client ID 和祕密
# 4. 取得新的 GOOGLE_CLIENT_SECRET

# Step 2：將 .env 加入 .gitignore
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore

# Step 3：使用環境變數或祕密管理
# 方案 A：環境變數（開發環境）
export GOOGLE_CLIENT_SECRET="new-secret-here"

# 方案 B：AWS Secrets Manager（生產環境）
# 方案 C：HashiCorp Vault（企業環境）
```

**代碼修改**（`apps/api/src/api/core/config.py`）：
```python
# 改為從環境變數讀取，無預設值
GOOGLE_CLIENT_SECRET: str = Field(..., validation_alias="GOOGLE_CLIENT_SECRET")  # 必填

# 驗證祕密是否設定
if not self.GOOGLE_CLIENT_SECRET:
    raise ValueError("GOOGLE_CLIENT_SECRET environment variable not set")
```

**影響範圍**：
- 所有 Google OAuth2 登入功能
- 學生身份驗證機制

**修復優先級**：⚠️ **立即（< 4 小時）**

---

### 2. OAuth2 異常處理缺乏日誌與驗證

**位置**：`apps/api/src/api/routers/auth.py:76-82`

**現有代碼**：
```python
@router.post("/auth/google/callback")
async def google_oauth_callback(code: str = Query(...)):
    try:
        # OAuth2 認證邏輯
        token = await authlib_client.fetch_token(code)
    except Exception:  # ❌ 過度寬泛
        raise HTTPException(401, "Unauthorized")
    # 無日誌，難以追蹤攻擊
```

**問題**：
- `except Exception` 掩蓋真實錯誤（網路故障、Google API 變更等）
- **無日誌記錄** — 無法偵測暴力破解、token 竊取、重放攻擊
- 無速率限制

**危害**：
- 攻擊者可重複嘗試 OAuth2 劫持，無任何告警
- 排查問題困難

**修復方案**：
```python
import logging
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.core.exc import OAuthError

logger = logging.getLogger(__name__)

@router.post("/auth/google/callback")
async def google_oauth_callback(
    code: str = Query(...),
    client_ip: str = Depends(get_client_ip)
):
    try:
        token = await authlib_client.fetch_token(code)
    except OAuthError as e:
        logger.warning(
            "OAuth2 authentication failed",
            extra={
                "code": code[:10] + "***",  # 部分掩蓋
                "error": str(e),
                "client_ip": client_ip,
            }
        )
        # Rate limit 檢查
        await check_oauth_rate_limit(client_ip)
        raise HTTPException(401, "OAuth2 authentication failed")
    except Exception as e:
        logger.error(
            "Unexpected error in OAuth2 callback",
            exc_info=True,
            extra={"client_ip": client_ip}
        )
        raise HTTPException(500, "Internal server error")
    
    # ... 後續邏輯
```

**修復優先級**：⚠️ **立即（< 2 小時）**

---

### 3. Rate Limit 異常時靜默失敗（DoS 風險）

**位置**：`apps/api/src/api/core/rate_limit.py:79-82`

**現有代碼**：
```python
async def check_rate_limit(key: str, limit: int = 100):
    try:
        current = await redis.incr(key)
        if current > limit:
            raise HTTPException(429, "Too many requests")
    except Exception:
        pass  # ❌ 靜默失敗：Redis 故障時無限制通過
```

**危害**：
- Redis 故障時，系統失去所有速率控制
- 可被用於 DoS 攻擊：先癱瘓 Redis，再無限請求

**修復方案**：
```python
async def check_rate_limit(key: str, limit: int = 100):
    try:
        current = await redis.incr(key)
        # 設定過期時間（1 小時）
        await redis.expire(key, 3600)
        if current > limit:
            raise HTTPException(429, "Too many requests")
    except RedisError as e:
        logger.error("Rate limit Redis error", exc_info=True)
        # 降級到簡單的記憶體 rate limit
        await apply_fallback_rate_limit(key, limit)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected rate limit error", exc_info=True)
        raise HTTPException(500, "Internal server error")
```

**修復優先級**：⚠️ **立即（< 2 小時）**

---

### 4. 超級管理員權限自動授予

**位置**：`apps/api/src/api/routers/auth.py:101-105`

**現有代碼**：
```python
@router.post("/auth/google/callback")
async def google_oauth_callback(...):
    # ...
    user = await get_or_create_user(db, google_user_email)
    # ❌ 檢查環境變數自動設定超管
    if google_user_email in os.getenv("SUPERUSER_EMAILS", "").split(","):
        user.is_superuser = True
    
    await db.commit()
```

**危害**：
- **如 Google OAuth2 祕密洩露**，攻擊者可直接成為超管
- `SUPERUSER_EMAILS` 在環境變數中明文存儲
- 未提供操作日誌

**修復方案**：

**方案 A：移除環境變數自動授予**
```python
# 只有明確 admin 操作才能升級超管
@router.post("/admin/users/{user_id}/make-superuser")
async def make_superuser(
    user_id: UUID,
    db: DbDep,
    admin: Annotated[User, Depends(require_permission("admin:all"))],
    admin_ip: str = Depends(get_client_ip),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    
    user.is_superuser = True
    await db.commit()
    
    logger.info(
        "User promoted to superuser",
        extra={"target_user": user_id, "admin": admin.id, "ip": admin_ip}
    )
```

**方案 B：使用 IP 白名單 + 2FA**
```python
# 配置
ADMIN_IP_WHITELIST = ["192.168.1.100", "10.0.0.50"]
REQUIRE_2FA_FOR_SUPERUSER = True

@router.post("/auth/google/callback")
async def google_oauth_callback(..., client_ip: str = Depends(get_client_ip)):
    user = await get_or_create_user(db, google_user_email)
    
    # 檢查 IP + 2FA
    if google_user_email in ADMIN_CANDIDATES:
        if client_ip not in ADMIN_IP_WHITELIST:
            logger.warning(
                "Unauthorized admin access attempt",
                extra={"email": google_user_email, "ip": client_ip}
            )
            raise HTTPException(403, "Admin access denied from this IP")
        
        if REQUIRE_2FA_FOR_SUPERUSER and not user.mfa_enabled:
            raise HTTPException(403, "2FA required for superuser access")
        
        user.is_superuser = True
```

**修復優先級**：⚠️ **立即（< 1 小時）**

---

## 🟠 HIGH 優先級問題（1 週內解決）

### 5. CSRF 保護缺失

**位置**：`apps/api/src/api/__init__.py` - FastAPI 初始化

**問題**：所有 POST/PATCH/DELETE 端點無 CSRF token 驗證

**修復**：
```python
from fastapi_csrf_protect import CsrfProtect

@app.on_event("startup")
async def startup():
    CsrfProtect.load_config(app, config=CsrfSettings())

# 在路由中使用
@router.post("/documents")
async def create_document(
    csrf_protect: CsrfProtect = Depends()
):
    await csrf_protect.validate_csrf(request)  # 驗證 token
```

**預估工作量**：1 小時

---

### 6. 缺乏廣泛的安全日誌

**問題**：關鍵業務操作（權限變更、敏感資料修改）無詳細日誌

**修復方案**：統一日誌中介軟體
```python
class SecurityAuditMiddleware(BaseHTTPMiddleware):
    SENSITIVE_ENDPOINTS = [
        "/admin/",  # 所有管理端點
        "/documents/*/approve",  # 簽核
        "/regulations/*/publish",  # 發佈法規
    ]
    
    async def dispatch(self, request, call_next):
        if any(request.url.path.startswith(ep) for ep in self.SENSITIVE_ENDPOINTS):
            logger.info(
                "Security audit event",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "user": request.user.id,
                    "ip": request.client.host,
                    "timestamp": datetime.now().isoformat(),
                }
            )
        response = await call_next(request)
        return response
```

**預估工作量**：2 小時

---

### 7. 輸入驗證不完整

**位置**：`apps/api/src/api/schemas/document.py`

**問題**：
```python
class DocumentCreate(BaseModel):
    title: str  # ❌ 無長度限制
    category: str  # ❌ 應使用 Enum
    content: str = ""  # ❌ 無最大長度
```

**修復**：
```python
from pydantic import Field, validator

class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: DocumentCategory  # 使用 Enum
    content: str = Field(default="", max_length=50000)
    
    @validator("content")
    def validate_no_xss(cls, v):
        if "<script>" in v.lower():
            raise ValueError("Script tags not allowed")
        return v
```

**預估工作量**：1.5 小時

---

### 8. 缺乏異常行為檢測

**問題**：未監控異常登入（地點突變、速率異常）

**修復方案**：簡單異常偵測
```python
@router.post("/auth/google/callback")
async def google_oauth_callback(...):
    # ... 標準驗證
    
    # 檢查異常
    last_login = await redis.get(f"user:{user.id}:last_login_ip")
    if last_login and last_login != client_ip:
        # 地點改變，可能被劫持
        if not await check_geolocation_plausibility(last_login, client_ip):
            logger.warning(
                "Suspicious login location change",
                extra={"user": user.id, "from": last_login, "to": client_ip}
            )
            # 可選：要求額外驗證
            if REQUIRE_2FA_FOR_LOCATION_CHANGE:
                user.pending_2fa = True
    
    await redis.set(f"user:{user.id}:last_login_ip", client_ip, ex=30*86400)
```

**預估工作量**：2 小時

---

## 🟡 MEDIUM 優先級問題（2-4 週內解決）

### 9. 廣泛的異常捕獲 - auth.py

**位置**：`apps/api/src/api/dependencies/auth.py:36-40`

**代碼**：
```python
async def get_current_user(token: str) -> User | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return None  # ❌ 掩蓋真實錯誤
```

**修復**：
```python
async def get_current_user(token: str) -> User | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        logger.debug("Token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error decoding token", exc_info=True)
        return None
```

**預估工作量**：1 小時

---

### 10-12. N+1 查詢、缺乏索引、列表無分頁

（詳見效能優化報告）

---

## 🟢 LOW 優先級問題（月度改進）

### 13-15. 代碼品質、文檔、舊 Alembic 遷移清理

---

## 🛡️ 額外安全建議

### 立即實裝

- [ ] **Content Security Policy (CSP)**
  ```python
  app.add_middleware(
      TrustedHostMiddleware,
      allowed_hosts=["*.example.com", "example.com"]
  )
  ```

- [ ] **X-Frame-Options 防點擊劫持**
  ```python
  response.headers["X-Frame-Options"] = "DENY"
  ```

- [ ] **密碼強度驗證**（如需本地認證）
  ```python
  MINIMUM_PASSWORD_LENGTH = 12
  REQUIRE_SPECIAL_CHARS = True
  ```

### 2-4 週內完成

- [ ] **HTTP Strict-Transport-Security (HSTS)**
  ```python
  response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  ```

- [ ] **SQL Injection 防護檢查**（已使用 ORM，低風險）

- [ ] **依賴套件安全掃描**
  ```bash
  pip-audit
  safety check
  npm audit
  ```

### 3-6 個月內完成

- [ ] 實裝 WAF（Web Application Firewall）
- [ ] 定期安全滲透測試
- [ ] 建立安全事件回應流程
- [ ] 加密敏感欄位（使用 `cryptography` 庫）

---

## ✅ 修復優先順序

**立即（< 4 小時）**：
1. 重設 Google OAuth2 祕密
2. 修復 OAuth2 異常捕獲 + 日誌
3. 修復 Rate limit 靜默失敗
4. 移除 SUPERUSER_EMAILS 自動授予

**Today（< 8 小時）**：
5. 添加 CSRF 保護
6. 添加安全日誌中介軟體

**This Week**：
7. 輸入驗證補全
8. 異常行為偵測

---

**修復檢查清單**：
- [ ] 安全問題修復已完成
- [ ] 新代碼已過 security-review
- [ ] 單元測試覆蓋安全路徑
- [ ] 日誌正確記錄所有操作
- [ ] 無新的未捕獲異常
