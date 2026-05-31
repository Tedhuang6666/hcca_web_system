"""安全的應用設定 / .env 編輯後端核心。

設計重點：
  - 不做「裸 .env 文字編輯」；只允許 schema 已知欄位，寫檔前用 pydantic 完整重建驗證一次。
  - 密鑰預設遮罩；明文與寫檔由路由層強制 MFA 再驗證（重用 verify_mfa）。
  - 寫檔原子性 + 時間戳備份；保留現有 .env 註解與順序。
  - 不在 log/audit/錯誤訊息中夾帶密鑰值（路由層處理）。
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import tempfile
import time
import typing
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from pydantic import ValidationError

from api.core.config import Settings, settings

# 不可由網頁編輯（衍生／不適合於執行期改）
DENYLIST: frozenset[str] = frozenset(
    {
        "APP_VERSION",
    }
)

# 密鑰：UI 預設遮罩、明文與儲存須 MFA。
# 用「明確清單 + 保守 substring」雙重認定，避免如 ACCESS_TOKEN_EXPIRE_MINUTES 等
# 名稱含 TOKEN 但實為時長的欄位被誤判。
_SECRET_KEYS_EXPLICIT: frozenset[str] = frozenset(
    {
        "DATABASE_URL",
        "DATABASE_URL_SYNC",
        "REDIS_URL",
        "GOOGLE_CLIENT_SECRET",
        "RESEND_API_KEY",
        "LINE_CHANNEL_SECRET",
        "LINE_CHANNEL_ACCESS_TOKEN",
        "DISCORD_CLIENT_SECRET",
        "DISCORD_BOT_TOKEN",
        "MEILISEARCH_API_KEY",
        "VAPID_PRIVATE_KEY",
        "SENTRY_DSN",
    }
)
_SECRET_SUBSTRINGS: tuple[str, ...] = ("PASSWORD", "SECRET", "PRIVATE_KEY")


def is_secret_key(key: str) -> bool:
    if key in _SECRET_KEYS_EXPLICIT:
        return True
    return any(token in key for token in _SECRET_SUBSTRINGS)


# ── 分類 ────────────────────────────────────────────────────────────────────


def _classify(key: str) -> str:
    if key in {
        "APP_NAME",
        "APP_VERSION",
        "ENVIRONMENT",
        "DEBUG",
        "ENABLE_API_DOCS",
        "ALLOWED_ORIGINS",
        "ALLOWED_HOSTS",
        "ENABLE_ENV_EDITOR",
    }:
        return "應用程式"
    if (
        key.startswith("DATABASE_")
        or key.startswith("DB_")
        or key in {"SQL_ECHO", "HEALTHCHECK_TIMEOUT_SECONDS", "SLOW_REQUEST_THRESHOLD_MS"}
    ):
        return "資料庫"
    if key.startswith("REDIS_"):
        return "Redis"
    if key in {"TRUST_CLOUDFLARE_PROXY", "CF_TRUSTED_PROXIES"}:
        return "代理 / 網路"
    if key.startswith("WS_"):
        return "WebSocket"
    if key.startswith("PAYLOAD_"):
        return "Payload"
    if key.startswith("SENTRY_"):
        return "監控 / Sentry"
    if key.startswith("MEILISEARCH_"):
        return "搜尋"
    if key.startswith("VAPID_"):
        return "Web Push"
    if key.startswith("PASSKEY_"):
        return "Passkeys"
    if key.startswith("LOAD_SHED_"):
        return "Load Shedding"
    if key.startswith("MODULE_CIRCUIT_"):
        return "模組斷路器"
    if (
        key.startswith("MFA_")
        or key.startswith("SECURITY_")
        or key
        in {
            "SECRET_KEY",
            "ALGORITHM",
            "COOKIE_SECURE",
            "COOKIE_SAMESITE",
            "ACCESS_TOKEN_EXPIRE_MINUTES",
            "REFRESH_TOKEN_EXPIRE_DAYS",
            "ACCESS_TOKEN_COOKIE_NAME",
            "REFRESH_TOKEN_COOKIE_NAME",
            "SESSION_COOKIE_NAME",
            "REQUIRE_2FA_FOR_SUPERUSER",
            "ADMIN_IP_WHITELIST",
        }
    ):
        return "安全與 JWT"
    if key.startswith("GOOGLE_") or key.startswith("LOGIN_"):
        return "Google OAuth / 登入"
    if key.startswith("MAIL_") or key in {
        "RESEND_API_KEY",
        "FRONTEND_BASE_URL",
        "EMAIL_DAILY_QUOTA_PER_USER",
    }:
        return "Email"
    if key in {"OWNER_EMAILS", "SUPERUSER_EMAILS"}:
        return "超管帳號"
    if key.startswith("RATE_LIMIT_"):
        return "限流"
    if key.startswith("LINE_"):
        return "LINE Bot"
    if key.startswith("DISCORD_"):
        return "Discord"
    if key.startswith("STORAGE_") or key.startswith("S3_"):
        return "儲存"
    if key.startswith("DB_BACKUP_"):
        return "資料庫備份"
    return "其他"


# ── 型別提示給前端 ──────────────────────────────────────────────────────────


def _type_hint(annotation: Any) -> str:
    if annotation is bool:
        return "bool"
    if annotation in (int, float):
        return "number"
    origin = typing.get_origin(annotation)
    if origin in (list, tuple, set):
        return "list"
    return "string"


# ── .env 路徑解析 ───────────────────────────────────────────────────────────


def resolve_env_path() -> Path:
    """複刻 Settings 的 env_file 搜尋（apps/api/.env → 工作區根 .env），回傳實際生效檔。"""
    candidates: list[Path] = []
    raw = Settings.model_config.get("env_file") or ()
    if isinstance(raw, str | os.PathLike):
        raw = (raw,)
    for rel in raw:
        candidates.append(Path(rel).resolve())
    for p in candidates:
        if p.exists():
            return p
    # 都不存在：回傳第一個候選（建立用）
    return candidates[0] if candidates else Path(".env").resolve()


# ── 讀／寫 .env ─────────────────────────────────────────────────────────────


def read_env_file() -> dict[str, str]:
    """以 python-dotenv 讀現行 .env，回傳 {KEY: 原始字串}。"""
    path = resolve_env_path()
    if not path.exists():
        return {}
    raw = dotenv_values(path)
    return {k: ("" if v is None else v) for k, v in raw.items()}


def _quote_if_needed(value: str) -> str:
    if value == "":
        return ""
    if any(ch in value for ch in (" ", "\t", "#", '"', "'")):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def write_env_changes(changes: Mapping[str, str], *, keep_backups: int = 5) -> list[str]:
    """就地替換／附加 KEY=VALUE，保留註解與順序；寫檔前先備份。回傳更新的 key 列表。

    傳入的 value 為「寫入 .env 的字串表示」（list 請已 JSON dump、bool 為 "true"/"false"）。
    """
    if not changes:
        return []
    for v in changes.values():
        if "\n" in v or "\r" in v:
            raise ValueError("設定值不可包含換行字元")

    path = resolve_env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_lines: list[str] = []
    if path.exists():
        existing_lines = path.read_text(encoding="utf-8").splitlines(keepends=True)

    # 備份
    if path.exists():
        ts = time.strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(f"{path.name}.bak.{ts}")
        shutil.copy2(path, backup)
        _prune_backups(path, keep_backups)

    # 就地替換
    remaining = dict(changes)
    new_lines: list[str] = []
    for line in existing_lines:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in remaining:
            new_lines.append(f"{key}={_quote_if_needed(remaining.pop(key))}\n")
        else:
            new_lines.append(line)

    # 新鍵附加在末
    if remaining:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        new_lines.append("\n# --- 由系統設定頁新增 ---\n")
        for key, val in remaining.items():
            new_lines.append(f"{key}={_quote_if_needed(val)}\n")

    # 原子寫入
    fd, tmp_path = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.writelines(new_lines)
        os.replace(tmp_path, path)
    except Exception:
        with contextlib.suppress(Exception):
            os.unlink(tmp_path)
        raise

    return list(changes.keys())


def _prune_backups(env_path: Path, keep: int) -> None:
    pattern = f"{env_path.name}.bak.*"
    backups = sorted(env_path.parent.glob(pattern))
    for old in backups[: max(0, len(backups) - keep)]:
        with contextlib.suppress(Exception):
            old.unlink()


# ── 顯示／序列化 ────────────────────────────────────────────────────────────


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list | tuple | set):
        return json.dumps(list(value), ensure_ascii=False)
    return str(value)


def list_fields(env_overlay: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """列出可編輯欄位。env_overlay 給「reveal」流程用（傳入真值取代遮罩）。"""
    env_dict = read_env_file()
    overlay = env_overlay or {}
    out: list[dict[str, Any]] = []
    for key, field in Settings.model_fields.items():
        if key in DENYLIST:
            continue
        category = _classify(key)
        secret = is_secret_key(key)
        in_file = key in env_dict
        raw_value = env_dict.get(key)
        if raw_value is None:
            raw_value = _stringify(getattr(settings, key, ""))
        display = raw_value
        if secret and key not in overlay:
            display = "" if raw_value == "" else "••••••"
        elif secret and key in overlay:
            display = overlay[key]
        out.append(
            {
                "key": key,
                "category": category,
                "type": _type_hint(field.annotation),
                "is_secret": secret,
                "in_file": in_file,
                "value": display,
                "description": field.description or "",
            }
        )
    out.sort(key=lambda f: (f["category"], f["key"]))
    return out


def editable_keys() -> set[str]:
    return {k for k in Settings.model_fields if k not in DENYLIST}


# ── 驗證 ────────────────────────────────────────────────────────────────────


def validate_changes(changes: Mapping[str, str]) -> None:
    """把現行 .env 與 changes 合併寫到 tmp，以 Settings(_env_file=tmp) 完整重建，
    觸發所有 field validator 與 model_validator。失敗 → 拋 ValidationError 或 ValueError。
    """
    allowed = editable_keys()
    bad = [k for k in changes if k not in allowed]
    if bad:
        raise ValueError(f"未知或不可編輯的設定：{', '.join(bad)}")

    current = read_env_file()
    merged = {**current, **changes}

    fd, tmp = tempfile.mkstemp(suffix=".env")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            for k, v in merged.items():
                fh.write(f"{k}={_quote_if_needed(v)}\n")
        try:
            Settings(_env_file=tmp, _env_file_encoding="utf-8")
        except ValidationError:
            raise
    finally:
        with contextlib.suppress(Exception):
            os.unlink(tmp)
