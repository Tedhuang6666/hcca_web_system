"""電子證件路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.electronic_credential import ElectronicCredentialOut
from api.services import electronic_credential as credential_svc

router = APIRouter(prefix="/electronic-credentials", tags=["電子證件"])

CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get("/me", response_model=ElectronicCredentialOut, summary="取得我的電子證件")
async def get_my_electronic_credential(
    current_user: CurrentUser,
) -> ElectronicCredentialOut:
    credential = await credential_svc.get_my_credential(current_user)
    if credential is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="電子證件僅提供校內帳號或經特別授權的個人帳號。",
        )
    return credential
