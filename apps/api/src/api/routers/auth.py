"""身份驗證路由 - Google OAuth2 + JWT Token 管理"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.oauth import google
from api.core.security import (
    add_to_blacklist,
    create_access_token,
    create_refresh_token,
    decode_token,
    is_blacklisted,
)
from api.models.user import User
from api.schemas.auth import RefreshRequest, TokenPair

router = APIRouter(prefix="/auth", tags=["身份驗證"])


@router.get("/google/login", summary="發起 Google OAuth2 登入")
async def google_login(request: Request) -> RedirectResponse:
    """將使用者重導向至 Google 授權頁面"""
    redirect_uri = str(request.url_for("google_callback"))
    return await google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback", name="google_callback", summary="Google OAuth2 Callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)) -> TokenPair:
    """
    處理 Google 授權回呼：
    1. 換取 ID Token
    2. 建立或更新使用者
    3. 回傳 JWT Token Pair
    """
    try:
        token_data = await google.authorize_access_token(request)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"OAuth2 授權失敗: {e}"
        ) from e

    user_info = token_data.get("userinfo") or await google.userinfo(token=token_data)

    google_sub: str = user_info["sub"]
    email: str = user_info["email"]
    display_name: str = user_info.get("name", email.split("@")[0])
    avatar_url: str | None = user_info.get("picture")

    # 查詢或建立使用者
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()

    if user is None:
        # 嘗試用 email 找到現有帳號並關聯
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            google_sub=google_sub,
            is_verified=True,
        )
        db.add(user)
    else:
        user.google_sub = google_sub
        user.avatar_url = avatar_url
        user.display_name = display_name

    await db.flush()

    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    return TokenPair(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", summary="使用 Refresh Token 換發 Access Token")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    """驗證 Refresh Token 並發行新的 Token Pair"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="無效的 Refresh Token"
    )

    if await is_blacklisted(body.refresh_token):
        raise credentials_exception

    try:
        payload = decode_token(body.refresh_token)
    except InvalidTokenError as e:
        raise credentials_exception from e

    if payload.get("type") != "refresh":
        raise credentials_exception

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception

    # 舊 Refresh Token 加入黑名單（Token Rotation）
    await add_to_blacklist(body.refresh_token)

    return TokenPair(
        access_token=create_access_token(subject=str(user.id)),
        refresh_token=create_refresh_token(subject=str(user.id)),
    )


@router.post("/logout", summary="登出（使 Token 失效）")
async def logout(
    request: Request,
) -> dict[str, str]:
    """將 Access Token 加入黑名單實現登出"""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        await add_to_blacklist(token)
    return {"message": "已成功登出"}
