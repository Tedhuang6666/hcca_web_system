"""全站搜尋 API."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import search as search_service

router = APIRouter(prefix="/search", tags=["搜尋"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class SearchResultOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: str
    title: str
    summary: str = ""
    href: str


class SearchIndexOut(BaseModel):
    enabled: bool
    indexed: int
    index: str | None = None


@router.get("", response_model=list[SearchResultOut], summary="全站搜尋")
async def global_search(
    db: DbDep,
    current_user: CurrentUser,
    q: str = Query("", max_length=120),
    limit: int = Query(10, ge=1, le=30),
) -> list[SearchResultOut]:
    return [
        SearchResultOut.model_validate(item)
        for item in await search_service.search(
            db, q, limit=limit, is_superuser=current_user.is_superuser
        )
    ]


@router.post(
    "/reindex",
    response_model=SearchIndexOut,
    summary="重建全站搜尋索引",
    dependencies=[Depends(require_permission("admin:all"))],
)
async def reindex(db: DbDep) -> SearchIndexOut:
    return SearchIndexOut.model_validate(await search_service.rebuild_index(db))
