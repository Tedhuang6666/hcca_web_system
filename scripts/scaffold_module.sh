#!/usr/bin/env bash
# scripts/scaffold_module.sh  —  新增 HCCA 後端模組骨架
#
# 用法：
#   ./scripts/scaffold_module.sh <module_slug> "<中文模組名>"
#
# 範例：
#   ./scripts/scaffold_module.sh exam_paper "試卷"
#
# 生成的檔案（若已存在則跳過，不覆蓋）：
#   apps/api/src/api/models/<slug>.py
#   apps/api/src/api/schemas/<slug>.py
#   apps/api/src/api/services/<slug>.py
#   apps/api/src/api/routers/<slug>s.py
#   apps/api/tests/test_<slug>s.py
#
# 完成後顯示剩餘手動步驟清單。

set -euo pipefail

SLUG="${1:-}"
LABEL="${2:-}"

if [[ -z "$SLUG" || -z "$LABEL" ]]; then
    echo "用法：$0 <module_slug> \"<中文模組名>\"" >&2
    exit 1
fi

# 驗證 slug 格式（小寫英數字加底線）
if [[ ! "$SLUG" =~ ^[a-z][a-z0-9_]*$ ]]; then
    echo "錯誤：slug 只能包含小寫英文、數字、底線，且須以英文開頭" >&2
    exit 1
fi

PLURAL="${SLUG}s"
CLASS=$(echo "$SLUG" | sed -E 's/(^|_)([a-z])/\U\2/g')   # snake_case → PascalCase
API_ROOT="apps/api/src/api"
TEST_DIR="apps/api/tests"

MODEL_FILE="$API_ROOT/models/${SLUG}.py"
SCHEMA_FILE="$API_ROOT/schemas/${SLUG}.py"
SERVICE_FILE="$API_ROOT/services/${SLUG}.py"
ROUTER_FILE="$API_ROOT/routers/${PLURAL}.py"
TEST_FILE="$TEST_DIR/test_${PLURAL}.py"

write_if_missing() {
    local path="$1"
    local content="$2"
    if [[ -e "$path" ]]; then
        echo "  [skip] $path（已存在）"
    else
        printf '%s\n' "$content" > "$path"
        echo "  [new]  $path"
    fi
}

echo "==> 為模組「${LABEL}」（${SLUG}）生成骨架..."

# ── Model ─────────────────────────────────────────────────────────────────────
write_if_missing "$MODEL_FILE" \
'"""'"${LABEL}"'模型 — '"${CLASS}"'"""

from __future__ import annotations

import uuid

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import SoftDeleteMixin, TimestampMixin


class '"${CLASS}"'(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "'"${PLURAL}"'"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)'

# ── Schema ────────────────────────────────────────────────────────────────────
write_if_missing "$SCHEMA_FILE" \
'"""'"${LABEL}"'讀寫 schema — Pydantic 模型"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class '"${CLASS}"'Create(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class '"${CLASS}"'Update(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)


class '"${CLASS}"'Out(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}'

# ── Service ───────────────────────────────────────────────────────────────────
write_if_missing "$SERVICE_FILE" \
'"""'"${LABEL}"'服務層 — 純 async 商業邏輯，不直接操作 HTTP 物件"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.'"${SLUG}"' import '"${CLASS}"'


async def get_'"${SLUG}"'(db: AsyncSession, '"${SLUG}"'_id: uuid.UUID) -> '"${CLASS}"' | None:
    result = await db.execute(
        select('"${CLASS}"').where('"${CLASS}"'.id == '"${SLUG}"'_id, '"${CLASS}"'.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def list_'"${PLURAL}"'(db: AsyncSession) -> list['"${CLASS}"']:
    result = await db.execute(
        select('"${CLASS}"').where('"${CLASS}"'.deleted_at.is_(None)).order_by('"${CLASS}"'.name)
    )
    return list(result.scalars().all())'

# ── Router ────────────────────────────────────────────────────────────────────
write_if_missing "$ROUTER_FILE" \
'"""'"${LABEL}"'路由 — /'"${PLURAL}"'"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import require_permission
from api.models.permission import PermissionCode
from api.schemas.'"${SLUG}"' import '"${CLASS}"'Create, '"${CLASS}"'Out
from api.services import '"${SLUG}"' as svc

router = APIRouter(prefix="/'"${PLURAL}"'", tags=["'"${LABEL}"'"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list['"${CLASS}"'Out])
async def list_'"${PLURAL}"'(db: DbDep, _=Depends(require_permission(PermissionCode.ADMIN_ALL))) -> list:
    return await svc.list_'"${PLURAL}"'(db)


@router.get("/{item_id}", response_model='"${CLASS}"'Out)
async def get_'"${SLUG}"'(
    item_id: uuid.UUID,
    db: DbDep,
    _=Depends(require_permission(PermissionCode.ADMIN_ALL)),
) -> object:
    obj = await svc.get_'"${SLUG}"'(db, item_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此'"${LABEL}"'")
    return obj'

# ── Test ──────────────────────────────────────────────────────────────────────
write_if_missing "$TEST_FILE" \
'"""'"${LABEL}"'路由整合測試"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_'"${PLURAL}"'_requires_auth(client: AsyncClient) -> None:
    """未登入應回 401。"""
    resp = await client.get("/'"${PLURAL}"'")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_'"${PLURAL}"'_empty(authed_client: AsyncClient) -> None:
    """有權限時應回空列表。"""
    resp = await authed_client.get("/'"${PLURAL}"'")
    assert resp.status_code == 200
    assert resp.json() == []'

echo ""
echo "==> 完成！骨架已生成。請手動完成以下步驟："
echo ""
echo "  1. apps/api/src/api/models/__init__.py"
echo "     在 __all__ 加入 '${CLASS}'"
echo ""
echo "  2. apps/api/src/api/main.py"
echo "     import:  from api.routers import ${PLURAL}"
echo "     掛載:    app.include_router(${PLURAL}.router)"
echo ""
echo "  3. 建立 Alembic migration（在 WSL 內執行）："
echo "     uv run --project apps/api alembic -c apps/api/alembic.ini revision --autogenerate \\"
echo "       -m \"add ${PLURAL} table\""
echo ""
echo "  4. 補齊 ${MODEL_FILE} 的完整欄位定義"
echo "  5. 補齊 ${SCHEMA_FILE} 的完整讀寫 schema"
echo "  6. 補齊 ${SERVICE_FILE} 的 create / update / delete 函式"
echo "  7. 補齊 ${ROUTER_FILE} 的 POST / PATCH / DELETE 端點"
echo "  8. 補充 ${TEST_FILE} 的 CRUD 測試案例"
echo ""
echo "  若要同時生成前端頁面骨架，執行："
echo "    ./scripts/scaffold_frontend.sh ${SLUG} \"${LABEL}\""
echo ""
