"""Discord 整合路由：OAuth 綁定、短效入口與角色映射管理。"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.oauth import discord
from api.core.permission_codes import PermissionCode
from api.core.redirects import safe_next_path
from api.core.security import create_access_token, create_refresh_token
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.discord_account import (
    DiscordAccountLink,
    DiscordGuildConfig,
    DiscordNicknamePrefixRule,
    DiscordOrgChannelMapping,
    DiscordRoleMapping,
    DiscordRoleMappingKind,
)
from api.models.user import User
from api.services import audit as audit_svc
from api.services import discord_gateway
from api.services.discord_bot import (
    bot_health_snapshot,
    consume_open_token,
    emit_moderation_log,
    enqueue_all_role_sync,
    enqueue_role_sync,
    get_user_link,
    is_configured,
    unlink_user,
    upsert_user_link,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discord", tags=["Discord Bot"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class DiscordBindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    linked: bool
    discord_user_id: str | None = None
    username: str | None = None
    global_name: str | None = None
    linked_at: datetime | None = None


class DiscordGuildConfigIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    name: str | None = Field(None, max_length=120)
    office_channel_id: str | None = Field(None, max_length=32)
    security_alert_channel_id: str | None = Field(None, max_length=32)
    petition_entry_channel_id: str | None = Field(None, max_length=32)
    petition_private_category_id: str | None = Field(None, max_length=32)
    petition_staff_role_id: str | None = Field(None, max_length=32)
    petition_private_channel_enabled: bool = True
    announcement_channel_id: str | None = Field(None, max_length=32)
    moderation_log_channel_id: str | None = Field(None, max_length=32)
    welcome_channel_id: str | None = Field(None, max_length=32)
    admin_role_id: str | None = Field(None, max_length=32)
    is_active: bool = True


class DiscordGuildConfigOut(DiscordGuildConfigIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DiscordRoleMappingIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    role_id: str = Field(..., min_length=1, max_length=32)
    mapping_kind: DiscordRoleMappingKind
    org_id: uuid.UUID | None = None
    position_id: uuid.UUID | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def target_must_match_kind(self) -> DiscordRoleMappingIn:
        if self.mapping_kind == DiscordRoleMappingKind.ORG and self.org_id is None:
            raise ValueError("組織身分組映射必須提供 org_id")
        if self.mapping_kind == DiscordRoleMappingKind.POSITION and self.position_id is None:
            raise ValueError("職位身分組映射必須提供 position_id")
        return self


class DiscordRoleMappingOut(DiscordRoleMappingIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DiscordOrgChannelMappingIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    org_id: uuid.UUID
    channel_id: str = Field(..., min_length=1, max_length=32)
    is_active: bool = True


class DiscordOrgChannelMappingOut(DiscordOrgChannelMappingIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DiscordNicknamePrefixRuleIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    prefix: str = Field(..., min_length=1, max_length=20)
    priority: int = Field(100, ge=0, le=999)
    mapping_kind: DiscordRoleMappingKind
    org_id: uuid.UUID | None = None
    position_id: uuid.UUID | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def target_must_match_kind(self) -> DiscordNicknamePrefixRuleIn:
        if self.mapping_kind == DiscordRoleMappingKind.ORG and self.org_id is None:
            raise ValueError("組織暱稱前綴規則必須提供 org_id")
        if self.mapping_kind == DiscordRoleMappingKind.POSITION and self.position_id is None:
            raise ValueError("職位暱稱前綴規則必須提供 position_id")
        return self


class DiscordNicknamePrefixRuleOut(DiscordNicknamePrefixRuleIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DiscordGuildOptionOut(BaseModel):
    id: str
    name: str
    icon: str | None = None


class DiscordChannelOptionOut(BaseModel):
    id: str
    name: str
    type: int
    parent_id: str | None = None


class DiscordRoleOptionOut(BaseModel):
    id: str
    name: str
    color: int = 0
    position: int = 0
    managed: bool = False


class DiscordBotHealthOut(BaseModel):
    bot_configured: bool
    oauth_configured: bool
    bot_user_id: str | None = None
    bot_username: str | None = None
    configured_guild_count: int
    has_active_links: bool


class DiscordSyncAllOut(BaseModel):
    queued: int


class DiscordTestMessageIn(BaseModel):
    channel_id: str = Field(..., min_length=1, max_length=32)
    message: str = Field("HCCA Discord Bot 測試訊息", min_length=1, max_length=500)


def _safe_next_path(value: str | None) -> str:
    return safe_next_path(value, default="/profile")


@router.get("/login", summary="發起 Discord OAuth 綁定")
async def discord_login(request: Request, current_user: CurrentUser) -> RedirectResponse:
    if not is_configured():
        raise HTTPException(status_code=503, detail="Discord OAuth 尚未設定")
    request.session["discord_link_user_id"] = str(current_user.id)
    request.session["discord_link_next"] = _safe_next_path(request.query_params.get("next"))
    redirect_uri = settings.DISCORD_REDIRECT_URI
    return await discord.authorize_redirect(request, redirect_uri)


@router.get("/callback", summary="Discord OAuth Callback")
async def discord_callback(request: Request, db: DbDep) -> RedirectResponse:
    frontend = settings.FRONTEND_BASE_URL.rstrip("/")
    user_id_raw = request.session.get("discord_link_user_id")
    next_path = _safe_next_path(request.session.get("discord_link_next"))
    if not user_id_raw:
        return RedirectResponse(url=f"{frontend}/profile?discord=missing-session")
    try:
        token = await discord.authorize_access_token(request)
        user_info = (await discord.get("users/@me", token=token)).json()
    except OAuthError:
        logger.warning("Discord OAuth failed", exc_info=True)
        return RedirectResponse(url=f"{frontend}/profile?discord=oauth-failed")
    user = await db.get(User, uuid.UUID(str(user_id_raw)))
    if user is None or not user.is_active:
        return RedirectResponse(url=f"{frontend}/profile?discord=user-not-found")
    link = await upsert_user_link(
        db,
        user_id=user.id,
        discord_user_id=str(user_info["id"]),
        username=user_info.get("username"),
        global_name=user_info.get("global_name"),
        avatar_hash=user_info.get("avatar"),
    )
    await enqueue_role_sync(db, user.id)
    await audit_svc.record(
        db,
        entity_type="discord_account_link",
        entity_id=str(link.id),
        action="discord.link",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"discord_user_id": link.discord_user_id, "username": link.username},
        summary="綁定 Discord 帳號",
    )
    return RedirectResponse(url=f"{frontend}{next_path}?discord=linked")


@router.get("/me", response_model=DiscordBindingOut, summary="取得我的 Discord 綁定狀態")
async def get_my_discord_binding(db: DbDep, current_user: CurrentUser) -> DiscordBindingOut:
    link = await get_user_link(db, current_user.id)
    if link is None:
        return DiscordBindingOut(linked=False)
    return DiscordBindingOut(
        linked=True,
        discord_user_id=link.discord_user_id,
        username=link.username,
        global_name=link.global_name,
        linked_at=link.linked_at,
    )


@router.post("/me/sync", status_code=204, summary="同步我的 Discord 身分組與暱稱")
async def sync_my_discord(db: DbDep, current_user: CurrentUser) -> None:
    await enqueue_role_sync(db, current_user.id)


@router.delete("/me", status_code=204, summary="解除我的 Discord 綁定")
async def delete_my_discord_binding(db: DbDep, current_user: CurrentUser) -> None:
    await unlink_user(db, current_user.id)


@router.get("/open", summary="Discord 短效登入並導向指定頁面")
async def open_from_discord(token: str = Query(...)) -> RedirectResponse:
    consumed = await consume_open_token(token)
    if consumed is None:
        return RedirectResponse(url=f"{settings.FRONTEND_BASE_URL.rstrip('/')}/login")
    user_id, path = consumed
    response = RedirectResponse(url=f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}")
    response.set_cookie(
        settings.ACCESS_TOKEN_COOKIE_NAME,
        create_access_token(subject=str(user_id), extra_claims={"source": "discord"}),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        create_refresh_token(subject=str(user_id)),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    return response


@router.get(
    "/guild-configs",
    response_model=list[DiscordGuildConfigOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def list_guild_configs(db: DbDep) -> list[DiscordGuildConfig]:
    return list((await db.execute(select(DiscordGuildConfig))).scalars().all())


@router.get(
    "/health",
    response_model=DiscordBotHealthOut,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="檢查 Discord Bot 產品設定與連線狀態",
)
async def discord_health(db: DbDep) -> DiscordBotHealthOut:
    try:
        return DiscordBotHealthOut(**await bot_health_snapshot(db))
    except Exception as exc:
        logger.warning("Discord health check failed", exc_info=True)
        raise HTTPException(status_code=502, detail="Discord Bot 健康檢查失敗") from exc


@router.post(
    "/sync-all",
    response_model=DiscordSyncAllOut,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="排程同步所有已綁定成員的 Discord 身分組與暱稱",
)
async def sync_all_discord_members(db: DbDep, current_user: CurrentUser) -> DiscordSyncAllOut:
    queued = await enqueue_all_role_sync(db)
    await audit_svc.record(
        db,
        entity_type="discord_account_link",
        entity_id="all",
        action="discord.sync_all",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"queued": queued},
        summary="排程同步所有 Discord 已綁定成員",
    )
    return DiscordSyncAllOut(queued=queued)


@router.post(
    "/test-message",
    status_code=204,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="送出 Discord 測試訊息",
)
async def send_discord_test_message(
    body: DiscordTestMessageIn, db: DbDep, current_user: CurrentUser
) -> None:
    await emit_moderation_log(
        db,
        guild_id=None,
        title="Discord Bot 測試",
        body=f"{body.message}\n目標頻道：{body.channel_id}",
    )
    from api.services.outbox import emit

    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": body.channel_id,
            "title": body.message,
            "body": "由後台送出的測試訊息。",
        },
    )
    await audit_svc.record(
        db,
        entity_type="discord_channel",
        entity_id=body.channel_id,
        action="discord.test_message",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(),
        summary="送出 Discord 測試訊息",
    )


@router.get(
    "/available-guilds",
    response_model=list[DiscordGuildOptionOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="列出 Bot 已加入的 Discord 伺服器",
)
async def available_guilds() -> list[DiscordGuildOptionOut]:
    guilds = await discord_gateway.inventory_guilds()
    if not guilds:
        raise HTTPException(status_code=503, detail="Discord Bot 離線或尚未回報伺服器清單")
    return [
        DiscordGuildOptionOut(
            id=str(item["id"]), name=str(item.get("name") or item["id"]), icon=item.get("icon")
        )
        for item in guilds
    ]


@router.get(
    "/guilds/{guild_id}/channels",
    response_model=list[DiscordChannelOptionOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="列出 Discord 伺服器頻道",
)
async def guild_channels(guild_id: str) -> list[DiscordChannelOptionOut]:
    guild = await discord_gateway.inventory_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot 未加入此 Discord 伺服器")
    channels = list(guild.get("channels", []))
    allowed_types = {0, 4, 5, 10, 11, 12, 15, 16}
    rows = [
        DiscordChannelOptionOut(
            id=str(item["id"]),
            name=str(item.get("name") or item["id"]),
            type=int(item.get("type") or 0),
            parent_id=str(item["parent_id"]) if item.get("parent_id") else None,
        )
        for item in channels
        if int(item.get("type") or 0) in allowed_types
    ]
    return sorted(rows, key=lambda item: (item.type, item.name.lower()))


@router.get(
    "/guilds/{guild_id}/roles",
    response_model=list[DiscordRoleOptionOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="列出 Discord 伺服器身分組",
)
async def guild_roles(guild_id: str) -> list[DiscordRoleOptionOut]:
    guild = await discord_gateway.inventory_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot 未加入此 Discord 伺服器")
    roles = list(guild.get("roles", []))
    rows = [
        DiscordRoleOptionOut(
            id=str(item["id"]),
            name=str(item.get("name") or item["id"]),
            color=int(item.get("color") or 0),
            position=int(item.get("position") or 0),
            managed=bool(item.get("managed")),
        )
        for item in roles
        if str(item.get("name") or "") != "@everyone"
    ]
    return sorted(rows, key=lambda item: item.position, reverse=True)


@router.post(
    "/guild-configs",
    response_model=DiscordGuildConfigOut,
    status_code=201,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def upsert_guild_config(
    body: DiscordGuildConfigIn, db: DbDep, current_user: CurrentUser
) -> DiscordGuildConfig:
    config = await db.scalar(
        select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == body.guild_id)
    )
    if config is None:
        config = DiscordGuildConfig(guild_id=body.guild_id)
        db.add(config)
    for key, value in body.model_dump().items():
        setattr(config, key, value)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_guild_config",
        entity_id=str(config.id),
        action="discord.guild_config.upsert",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(),
        summary="更新 Discord 伺服器設定",
    )
    return config


@router.get(
    "/role-mappings",
    response_model=list[DiscordRoleMappingOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def list_role_mappings(db: DbDep) -> list[DiscordRoleMapping]:
    return list((await db.execute(select(DiscordRoleMapping))).scalars().all())


@router.get(
    "/org-channel-mappings",
    response_model=list[DiscordOrgChannelMappingOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="列出機關公告頻道映射",
)
async def list_org_channel_mappings(db: DbDep) -> list[DiscordOrgChannelMapping]:
    return list((await db.execute(select(DiscordOrgChannelMapping))).scalars().all())


@router.post(
    "/org-channel-mappings",
    response_model=DiscordOrgChannelMappingOut,
    status_code=201,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="建立或更新機關公告頻道映射",
)
async def upsert_org_channel_mapping(
    body: DiscordOrgChannelMappingIn, db: DbDep, current_user: CurrentUser
) -> DiscordOrgChannelMapping:
    mapping = await db.scalar(
        select(DiscordOrgChannelMapping).where(
            DiscordOrgChannelMapping.guild_id == body.guild_id,
            DiscordOrgChannelMapping.org_id == body.org_id,
        )
    )
    if mapping is None:
        mapping = DiscordOrgChannelMapping(guild_id=body.guild_id, org_id=body.org_id)
        db.add(mapping)
    mapping.channel_id = body.channel_id
    mapping.is_active = body.is_active
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_org_channel_mapping",
        entity_id=str(mapping.id),
        action="discord.org_channel_mapping.upsert",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary="更新 Discord 機關公告頻道映射",
    )
    return mapping


@router.delete(
    "/org-channel-mappings/{mapping_id}",
    status_code=204,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="停用機關公告頻道映射",
)
async def delete_org_channel_mapping(
    mapping_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> None:
    mapping = await db.get(DiscordOrgChannelMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Discord 機關公告頻道映射不存在")
    mapping.is_active = False
    await audit_svc.record(
        db,
        entity_type="discord_org_channel_mapping",
        entity_id=str(mapping.id),
        action="discord.org_channel_mapping.disable",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary="停用 Discord 機關公告頻道映射",
    )


@router.get(
    "/nickname-prefix-rules",
    response_model=list[DiscordNicknamePrefixRuleOut],
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="列出 Discord 暱稱前綴同步規則",
)
async def list_nickname_prefix_rules(db: DbDep) -> list[DiscordNicknamePrefixRule]:
    return list((await db.execute(select(DiscordNicknamePrefixRule))).scalars().all())


@router.post(
    "/nickname-prefix-rules",
    response_model=DiscordNicknamePrefixRuleOut,
    status_code=201,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="建立 Discord 暱稱前綴同步規則",
)
async def create_nickname_prefix_rule(
    body: DiscordNicknamePrefixRuleIn, db: DbDep, current_user: CurrentUser
) -> DiscordNicknamePrefixRule:
    rule = DiscordNicknamePrefixRule(**body.model_dump())
    db.add(rule)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_nickname_prefix_rule",
        entity_id=str(rule.id),
        action="discord.nickname_prefix_rule.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary="建立 Discord 暱稱前綴規則",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)
    return rule


@router.patch(
    "/nickname-prefix-rules/{rule_id}",
    response_model=DiscordNicknamePrefixRuleOut,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="更新 Discord 暱稱前綴同步規則",
)
async def update_nickname_prefix_rule(
    rule_id: uuid.UUID,
    body: DiscordNicknamePrefixRuleIn,
    db: DbDep,
    current_user: CurrentUser,
) -> DiscordNicknamePrefixRule:
    rule = await db.get(DiscordNicknamePrefixRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Discord 暱稱前綴規則不存在")
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_nickname_prefix_rule",
        entity_id=str(rule.id),
        action="discord.nickname_prefix_rule.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary="更新 Discord 暱稱前綴規則",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)
    return rule


@router.delete(
    "/nickname-prefix-rules/{rule_id}",
    status_code=204,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
    summary="停用 Discord 暱稱前綴同步規則",
)
async def delete_nickname_prefix_rule(
    rule_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> None:
    rule = await db.get(DiscordNicknamePrefixRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Discord 暱稱前綴規則不存在")
    rule.is_active = False
    await audit_svc.record(
        db,
        entity_type="discord_nickname_prefix_rule",
        entity_id=str(rule.id),
        action="discord.nickname_prefix_rule.disable",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary="停用 Discord 暱稱前綴規則",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)


@router.post(
    "/role-mappings",
    response_model=DiscordRoleMappingOut,
    status_code=201,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def create_role_mapping(
    body: DiscordRoleMappingIn, db: DbDep, current_user: CurrentUser
) -> DiscordRoleMapping:
    mapping = DiscordRoleMapping(**body.model_dump())
    db.add(mapping)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_role_mapping",
        entity_id=str(mapping.id),
        action="discord.role_mapping.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary="建立 Discord 身分組映射",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)
    return mapping


@router.patch(
    "/role-mappings/{mapping_id}",
    response_model=DiscordRoleMappingOut,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def update_role_mapping(
    mapping_id: uuid.UUID,
    body: DiscordRoleMappingIn,
    db: DbDep,
    current_user: CurrentUser,
) -> DiscordRoleMapping:
    mapping = await db.get(DiscordRoleMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Discord 身分組映射不存在")
    for key, value in body.model_dump().items():
        setattr(mapping, key, value)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="discord_role_mapping",
        entity_id=str(mapping.id),
        action="discord.role_mapping.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary="更新 Discord 身分組映射",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)
    return mapping


@router.delete(
    "/role-mappings/{mapping_id}",
    status_code=204,
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def delete_role_mapping(mapping_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    mapping = await db.get(DiscordRoleMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Discord 身分組映射不存在")
    mapping.is_active = False
    await audit_svc.record(
        db,
        entity_type="discord_role_mapping",
        entity_id=str(mapping.id),
        action="discord.role_mapping.disable",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary="停用 Discord 身分組映射",
    )
    linked_user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    for user_id in linked_user_ids:
        await enqueue_role_sync(db, user_id)
