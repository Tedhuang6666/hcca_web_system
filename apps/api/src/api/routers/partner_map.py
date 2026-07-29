"""特約地圖路由 - /partner-map"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_any
from api.models.partner_map import (
    PartnerBusiness,
    PartnerBusinessAccount,
    PartnerBusinessImage,
    PartnerBusinessListingType,
    PartnerBusinessStatus,
    PartnerLocation,
    PartnerOffer,
    PartnerTag,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.partner_map import (
    PartnerBusinessAccountOut,
    PartnerBusinessAccountsUpdate,
    PartnerBusinessCreate,
    PartnerBusinessImageOut,
    PartnerBusinessListItem,
    PartnerBusinessOut,
    PartnerBusinessSelfUpdate,
    PartnerBusinessUpdate,
    PartnerDiscoveryItem,
    PartnerGoogleMapsParseIn,
    PartnerGoogleMapsParseOut,
    PartnerLocationCreate,
    PartnerLocationOut,
    PartnerLocationUpdate,
    PartnerMapItem,
    PartnerOfferCreate,
    PartnerOfferOut,
    PartnerOfferUpdate,
    PartnerRankingItem,
    PartnerRatingCreate,
    PartnerRatingOut,
    PartnerSubmissionCreate,
    PartnerSubmissionOut,
    PartnerSubmissionReview,
    PartnerTagCreate,
    PartnerTagOut,
    PartnerTagUpdate,
)
from api.services import audit as audit_svc
from api.services import partner_map as map_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/partner-map", tags=["特約地圖"])

_MAX_PROMO_IMAGES = 12
_PROMO_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

DbDep = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
BusinessManagerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.PARTNER_MAP_MANAGE,
            PermissionCode.PARTNER_MAP_BUSINESS_MANAGE,
        )
    ),
]
SubmissionReviewerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.PARTNER_MAP_MANAGE,
            PermissionCode.PARTNER_MAP_SUBMISSION_REVIEW,
        )
    ),
]


def _offer_out(offer: PartnerOffer, *, include_private: bool) -> PartnerOfferOut:
    out = PartnerOfferOut.model_validate(offer)
    out.is_current = map_svc.is_offer_current(offer)
    if not include_private:
        out.member_note = None
    return out


def _location_out(location: PartnerLocation, *, include_private: bool) -> PartnerLocationOut:
    out = PartnerLocationOut.model_validate(location)
    if not include_private:
        out.phone = None
    return out


def _business_out(
    business: PartnerBusiness,
    *,
    include_private: bool,
    include_internal: bool = False,
    viewer_id: uuid.UUID | None = None,
) -> PartnerBusinessOut:
    derived_fields = {
        "promo_images",
        "tags",
        "locations",
        "offers",
        "flyer_image_url",
        "rating_avg",
        "rating_count",
        "my_rating",
        "has_checked_in",
        "popularity_score",
        "can_view_private_details",
    }
    scalar_data = {
        field_name: getattr(business, field_name)
        for field_name in PartnerBusinessOut.model_fields
        if field_name not in derived_fields
    }
    scalar_data["promo_images"] = []
    out = PartnerBusinessOut.model_validate(scalar_data)
    out.tags = [PartnerTagOut.model_validate(tag) for tag in business.tags]
    rating_avg, rating_count = map_svc.rating_stats(business)
    out.can_view_private_details = include_private
    out.internal_note = business.internal_note if include_internal else None
    out.flyer_image_url = (
        f"/partner-map/businesses/{business.id}/flyer" if business.flyer_storage_key else None
    )
    image_prefix = (
        f"/partner-map/admin/businesses/{business.id}/images"
        if include_internal
        else f"/partner-map/businesses/{business.id}/images"
    )
    out.promo_images = [
        PartnerBusinessImageOut(
            id=image.id,
            business_id=image.business_id,
            image_url=f"{image_prefix}/{image.id}",
            filename=image.filename,
            content_type=image.content_type,
            sort_order=image.sort_order,
            created_at=image.created_at,
            updated_at=image.updated_at,
        )
        for image in business.promo_images
    ]
    out.rating_avg = rating_avg
    out.rating_count = rating_count
    out.my_rating = (
        next((rating.rating for rating in business.ratings if rating.user_id == viewer_id), None)
        if viewer_id
        else None
    )
    out.has_checked_in = (
        any(checkin.user_id == viewer_id for checkin in business.checkins) if viewer_id else False
    )
    out.popularity_score = map_svc.popularity_score(business)
    out.locations = (
        [
            _location_out(location, include_private=include_private)
            for location in business.locations
            if include_private or location.is_active
        ]
        if business.listing_type == PartnerBusinessListingType.PHYSICAL.value
        else []
    )
    out.offers = [
        _offer_out(offer, include_private=include_private)
        for offer in business.offers
        if include_private or map_svc.is_offer_current(offer)
    ]
    return out


def _list_item(business: PartnerBusiness) -> PartnerBusinessListItem:
    out = PartnerBusinessListItem.model_validate(business)
    rating_avg, rating_count = map_svc.rating_stats(business)
    out.location_count = len(business.locations)
    out.active_offer_count = map_svc.active_offer_count(business)
    out.rating_avg = rating_avg
    out.rating_count = rating_count
    out.popularity_score = map_svc.popularity_score(business)
    return out


def _discovery_item(business: PartnerBusiness) -> PartnerDiscoveryItem:
    offers = [offer for offer in business.offers if map_svc.is_offer_current(offer)]
    featured = offers[0] if offers else None
    return PartnerDiscoveryItem(
        id=business.id,
        name=business.name,
        summary=business.summary,
        logo_url=business.logo_url,
        cover_image_url=business.cover_image_url,
        category=business.category,
        listing_type=business.listing_type,
        tags=[PartnerTagOut.model_validate(tag) for tag in business.tags if tag.is_active],
        location_count=len([location for location in business.locations if location.is_active]),
        active_offer_count=len(offers),
        featured_offer_title=featured.title if featured else None,
        featured_offer_benefit_type=featured.benefit_type if featured else None,
        featured_offer_benefit_value=featured.benefit_value if featured else None,
    )


def _map_item(location: PartnerLocation, *, include_private: bool) -> PartnerMapItem:
    business = location.business
    current_offers = [offer for offer in business.offers if map_svc.is_offer_current(offer)]
    rating_avg, rating_count = map_svc.rating_stats(business)
    return PartnerMapItem(
        source="partner",
        business_id=business.id,
        location_id=location.id,
        business_name=business.name,
        location_name=location.name,
        summary=business.summary,
        logo_url=business.logo_url,
        cover_image_url=business.cover_image_url,
        category=business.category,
        business_hours_text=business.business_hours_text,
        business_hours=location.business_hours or business.business_hours,
        address=location.address,
        latitude=location.latitude,
        longitude=location.longitude,
        phone=location.phone if include_private else None,
        tags=[PartnerTagOut.model_validate(tag) for tag in business.tags if tag.is_active],
        has_active_offer=bool(current_offers),
        has_discount_offer=any(offer.benefit_type == "discount" for offer in current_offers),
        active_offer_titles=[offer.title for offer in current_offers],
        rating_avg=rating_avg,
        rating_count=rating_count,
        popularity_score=map_svc.popularity_score(business),
        view_count=business.view_count,
        checkin_count=business.checkin_count,
    )


async def _business_or_404(db: AsyncSession, business_id: uuid.UUID) -> PartnerBusiness:
    business = await map_svc.get_business(db, business_id)
    return or_404(business, "找不到此特約店家")


async def _managed_business_or_404(
    db: AsyncSession, business_id: uuid.UUID, user_id: uuid.UUID
) -> PartnerBusiness:
    business = await map_svc.get_managed_business(db, business_id, user_id)
    return or_404(business, "你沒有這間店家的編輯權限")


def _account_out(account: PartnerBusinessAccount) -> PartnerBusinessAccountOut:
    return PartnerBusinessAccountOut(
        id=account.id,
        business_id=account.business_id,
        user_id=account.user_id,
        display_name=account.user.display_name,
        email=account.user.email,
        is_active=account.is_active,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


async def _business_image_or_404(
    db: AsyncSession, business_id: uuid.UUID, image_id: uuid.UUID
) -> PartnerBusinessImage:
    image = await db.get(PartnerBusinessImage, image_id)
    if image is None or image.business_id != business_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此宣傳圖")
    return image


async def _serve_business_image(image: PartnerBusinessImage) -> FileResponse | RedirectResponse:
    storage = get_storage()
    local = storage.local_path(image.storage_key)
    if local is not None:
        if not local.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="宣傳圖不存在")
        return FileResponse(str(local), media_type=image.content_type)
    return RedirectResponse(await storage.get_url(image.storage_key, disposition="inline"))


async def _tag_or_404(db: AsyncSession, tag_id: uuid.UUID) -> PartnerTag:
    tag = await map_svc.get_tag(db, tag_id)
    return or_404(tag, "找不到此標籤")


async def _location_or_404(db: AsyncSession, location_id: uuid.UUID) -> PartnerLocation:
    location = await map_svc.get_location(db, location_id)
    return or_404(location, "找不到此點位")


async def _offer_or_404(db: AsyncSession, offer_id: uuid.UUID) -> PartnerOffer:
    offer = await map_svc.get_offer(db, offer_id)
    return or_404(offer, "找不到此優惠")


@router.get("", response_model=list[PartnerMapItem], summary="特約地圖點位列表")
async def list_map_items(
    db: DbDep,
    viewer: OptionalUser,
    tag_ids: list[uuid.UUID] | None = Query(None),
    keyword: str | None = Query(None, max_length=100),
    min_lat: float | None = Query(None, ge=-90, le=90),
    max_lat: float | None = Query(None, ge=-90, le=90),
    min_lng: float | None = Query(None, ge=-180, le=180),
    max_lng: float | None = Query(None, ge=-180, le=180),
    has_active_offer: bool = Query(False),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[PartnerMapItem]:
    locations = await map_svc.list_map_locations(
        db,
        tag_ids=tag_ids,
        keyword=keyword,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lng=min_lng,
        max_lng=max_lng,
        has_active_offer=has_active_offer,
        limit=limit,
        offset=offset,
    )
    return [_map_item(location, include_private=viewer is not None) for location in locations]


@router.get("/tags", response_model=list[PartnerTagOut], summary="列出特約標籤")
async def list_public_tags(db: DbDep) -> list[PartnerTag]:
    return await map_svc.list_tags(db)


@router.get("/discover", response_model=list[PartnerDiscoveryItem], summary="探索全部特約優惠")
async def discover_partners(
    db: DbDep,
    listing_type: PartnerBusinessListingType | None = Query(None),
    tag_ids: list[uuid.UUID] | None = Query(None),
    keyword: str | None = Query(None, max_length=100),
    has_active_offer: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[PartnerDiscoveryItem]:
    businesses = await map_svc.discover_businesses(
        db,
        listing_type=listing_type,
        tag_ids=tag_ids,
        keyword=keyword,
        has_active_offer=has_active_offer,
        limit=limit,
        offset=offset,
    )
    return [_discovery_item(business) for business in businesses]


@router.get(
    "/directory",
    response_model=list[PartnerBusinessListItem],
    summary="列出僅提供聯絡方式的合作夥伴",
)
async def list_contact_directory(
    db: DbDep,
    keyword: str | None = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[PartnerBusinessListItem]:
    return [
        _list_item(business)
        for business in await map_svc.list_contact_businesses(
            db, keyword=keyword, limit=limit, offset=offset
        )
    ]


@router.get(
    "/my-businesses",
    response_model=list[PartnerBusinessListItem],
    summary="列出我可管理的店家",
)
async def list_my_businesses(db: DbDep, user: CurrentUser) -> list[PartnerBusinessListItem]:
    return [_list_item(business) for business in await map_svc.list_managed_businesses(db, user.id)]


@router.get(
    "/businesses/{business_id}/self",
    response_model=PartnerBusinessOut,
    summary="店家帳號取得自己的店家資料",
)
async def get_self_business(
    business_id: uuid.UUID, db: DbDep, user: CurrentUser
) -> PartnerBusinessOut:
    business = await _managed_business_or_404(db, business_id, user.id)
    return _business_out(business, include_private=True)


@router.patch(
    "/businesses/{business_id}/self",
    response_model=PartnerBusinessOut,
    summary="店家帳號更新自己的店家資料",
)
async def update_self_business(
    business_id: uuid.UUID,
    body: PartnerBusinessSelfUpdate,
    db: DbDep,
    user: CurrentUser,
) -> PartnerBusinessOut:
    business = await _managed_business_or_404(db, business_id, user.id)
    try:
        business = await map_svc.update_business(db, business, body)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        db,
        entity_type="partner_business",
        entity_id=str(business.id),
        action="partner_map.business_self_update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"店家帳號更新「{business.name}」",
    )
    return _business_out(business, include_private=True)


@router.get("/rankings", response_model=list[PartnerRankingItem], summary="學生常去排行")
async def list_rankings(
    db: DbDep,
    limit: int = Query(10, ge=1, le=50),
) -> list[PartnerRankingItem]:
    businesses = await map_svc.ranking(db, limit=limit)
    result: list[PartnerRankingItem] = []
    for business in businesses:
        rating_avg, rating_count = map_svc.rating_stats(business)
        result.append(
            PartnerRankingItem(
                business_id=business.id,
                name=business.name,
                summary=business.summary,
                category=business.category,
                logo_url=business.logo_url,
                rating_avg=rating_avg,
                rating_count=rating_count,
                checkin_count=business.checkin_count,
                view_count=business.view_count,
                popularity_score=map_svc.popularity_score(business),
            )
        )
    return result


@router.get(
    "/businesses/{business_id}", response_model=PartnerBusinessOut, summary="取得特約店家詳情"
)
async def get_business_detail(
    business_id: uuid.UUID, db: DbDep, viewer: OptionalUser
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    await map_svc.increment_business_metric(db, business, "view")
    return _business_out(
        business, include_private=viewer is not None, viewer_id=viewer.id if viewer else None
    )


@router.get(
    "/businesses/{business_id}/flyer",
    response_model=None,
    summary="預覽特約店家照片或傳單",
)
async def preview_business_flyer(
    business_id: uuid.UUID, db: DbDep
) -> FileResponse | RedirectResponse:
    business = await _business_or_404(db, business_id)
    if business.status != PartnerBusinessStatus.ACTIVE.value or not business.flyer_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此店家照片")
    storage = get_storage()
    local = storage.local_path(business.flyer_storage_key)
    if local is not None:
        if not local.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="店家照片不存在")
        return FileResponse(str(local), media_type=business.flyer_content_type or "image/*")
    return RedirectResponse(await storage.get_url(business.flyer_storage_key, disposition="inline"))


@router.get(
    "/businesses/{business_id}/images/{image_id}",
    response_model=None,
    summary="預覽特約店家宣傳圖",
)
async def preview_business_image(
    business_id: uuid.UUID, image_id: uuid.UUID, db: DbDep
) -> FileResponse | RedirectResponse:
    business = await _business_or_404(db, business_id)
    if business.status != PartnerBusinessStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    return await _serve_business_image(await _business_image_or_404(db, business_id, image_id))


@router.post(
    "/businesses/{business_id}/click",
    response_model=PartnerBusinessOut,
    summary="記錄店家點擊",
)
async def record_business_click(
    business_id: uuid.UUID, db: DbDep, viewer: OptionalUser
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    business = await map_svc.increment_business_metric(db, business, "click")
    return _business_out(
        business, include_private=viewer is not None, viewer_id=viewer.id if viewer else None
    )


@router.post(
    "/businesses/{business_id}/check-in",
    response_model=PartnerBusinessOut,
    summary="記錄學生常去",
)
async def record_business_checkin(
    business_id: uuid.UUID, db: DbDep, viewer: CurrentUser
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    business = await map_svc.record_business_checkin(db, business, viewer.id)
    return _business_out(business, include_private=True, viewer_id=viewer.id)


@router.get(
    "/businesses/{business_id}/ratings",
    response_model=list[PartnerRatingOut],
    summary="列出店家評價",
)
async def list_business_ratings(
    business_id: uuid.UUID,
    db: DbDep,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[PartnerRatingOut]:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    return [
        PartnerRatingOut.model_validate(rating)
        for rating in await map_svc.list_ratings(db, business_id, limit=limit, offset=offset)
    ]


@router.post(
    "/businesses/{business_id}/ratings",
    response_model=PartnerRatingOut,
    status_code=status.HTTP_201_CREATED,
    summary="送出店家評價",
)
async def create_business_rating(
    business_id: uuid.UUID,
    body: PartnerRatingCreate,
    db: DbDep,
    viewer: CurrentUser,
) -> PartnerRatingOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    rating = await map_svc.upsert_rating(db, business, body, viewer.id)
    return PartnerRatingOut.model_validate(rating)


@router.post(
    "/admin/businesses/{business_id}/flyer",
    response_model=PartnerBusinessOut,
    summary="上傳特約店家照片或傳單",
)
async def admin_upload_business_flyer(
    business_id: uuid.UUID,
    db: DbDep,
    _: BusinessManagerUser,
    file: UploadFile = File(...),
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    try:
        stored = await get_storage().save(
            file,
            prefix=f"partner-map/{business.id}",
            max_file_size=10 * 1024 * 1024,
            allowed_content_types={"image/jpeg", "image/png", "image/gif", "image/webp"},
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    old_storage_key = business.flyer_storage_key
    business.flyer_storage_key = stored.storage_key
    business.flyer_filename = stored.filename
    business.flyer_content_type = stored.content_type
    await db.flush()
    if old_storage_key:
        await get_storage().delete(old_storage_key)
    return _business_out(business, include_private=True, include_internal=True)


@router.post(
    "/admin/businesses/{business_id}/images",
    response_model=PartnerBusinessOut,
    summary="新增特約店家宣傳圖",
)
async def admin_upload_business_image(
    business_id: uuid.UUID,
    db: DbDep,
    _: BusinessManagerUser,
    file: UploadFile = File(...),
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    if len(business.promo_images) >= _MAX_PROMO_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"每個店家最多上傳 {_MAX_PROMO_IMAGES} 張宣傳圖",
        )
    try:
        stored = await get_storage().save(
            file,
            prefix=f"partner-map/{business.id}/promos",
            max_file_size=10 * 1024 * 1024,
            allowed_content_types=_PROMO_IMAGE_TYPES,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    image = PartnerBusinessImage(
        business_id=business.id,
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        sort_order=max((item.sort_order for item in business.promo_images), default=-1) + 1,
    )
    db.add(image)
    await db.flush()
    await db.refresh(business, ["promo_images"])
    return _business_out(business, include_private=True, include_internal=True)


@router.get(
    "/admin/businesses/{business_id}/images/{image_id}",
    response_model=None,
    summary="管理端預覽特約店家宣傳圖",
)
async def admin_preview_business_image(
    business_id: uuid.UUID, image_id: uuid.UUID, db: DbDep, _: BusinessManagerUser
) -> FileResponse | RedirectResponse:
    await _business_or_404(db, business_id)
    return await _serve_business_image(await _business_image_or_404(db, business_id, image_id))


@router.delete(
    "/admin/businesses/{business_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除特約店家宣傳圖",
)
async def admin_delete_business_image(
    business_id: uuid.UUID, image_id: uuid.UUID, db: DbDep, _: BusinessManagerUser
) -> None:
    business = await _business_or_404(db, business_id)
    image = await _business_image_or_404(db, business_id, image_id)
    storage_key = image.storage_key
    await db.delete(image)
    await db.flush()
    await db.refresh(business, ["promo_images"])
    await get_storage().delete(storage_key)


@router.delete(
    "/admin/businesses/{business_id}/flyer",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除特約店家照片或傳單",
)
async def admin_delete_business_flyer(
    business_id: uuid.UUID, db: DbDep, _: BusinessManagerUser
) -> None:
    business = await _business_or_404(db, business_id)
    storage_key = business.flyer_storage_key
    business.flyer_storage_key = None
    business.flyer_filename = None
    business.flyer_content_type = None
    await db.flush()
    if storage_key:
        await get_storage().delete(storage_key)


@router.post(
    "/submissions",
    response_model=PartnerSubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="投稿新特約店家",
)
async def create_submission(
    body: PartnerSubmissionCreate,
    db: DbDep,
    viewer: OptionalUser,
) -> PartnerSubmissionOut:
    submission = await map_svc.create_submission(db, body, viewer.id if viewer else None)
    return PartnerSubmissionOut.model_validate(submission)


@router.get(
    "/admin/businesses",
    response_model=list[PartnerBusinessListItem],
    summary="管理端列出特約店家",
)
async def admin_list_businesses(
    db: DbDep,
    _: BusinessManagerUser,
    include_inactive: bool = Query(True),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[PartnerBusinessListItem]:
    businesses = await map_svc.list_businesses(
        db, include_inactive=include_inactive, limit=limit, offset=offset
    )
    return [_list_item(business) for business in businesses]


@router.post(
    "/admin/businesses",
    response_model=PartnerBusinessOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立特約店家",
)
async def admin_create_business(
    body: PartnerBusinessCreate, db: DbDep, user: BusinessManagerUser
) -> PartnerBusinessOut:
    try:
        business = await map_svc.create_business(db, body, created_by=user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="partner_business",
        entity_id=str(business.id),
        action="partner_map.business_create",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"建立特約店家「{business.name}」",
    )
    return _business_out(business, include_private=True, include_internal=True)


@router.get(
    "/admin/businesses/{business_id}",
    response_model=PartnerBusinessOut,
    summary="管理端取得特約店家詳情",
)
async def admin_get_business(
    business_id: uuid.UUID, db: DbDep, _: BusinessManagerUser
) -> PartnerBusinessOut:
    return _business_out(
        await _business_or_404(db, business_id), include_private=True, include_internal=True
    )


@router.get(
    "/admin/businesses/{business_id}/accounts",
    response_model=list[PartnerBusinessAccountOut],
    summary="列出店家可編輯帳號",
)
async def admin_list_business_accounts(
    business_id: uuid.UUID, db: DbDep, _: BusinessManagerUser
) -> list[PartnerBusinessAccountOut]:
    await _business_or_404(db, business_id)
    return [
        _account_out(account) for account in await map_svc.list_business_accounts(db, business_id)
    ]


@router.put(
    "/admin/businesses/{business_id}/accounts",
    response_model=list[PartnerBusinessAccountOut],
    summary="設定店家可編輯帳號",
)
async def admin_replace_business_accounts(
    business_id: uuid.UUID,
    body: PartnerBusinessAccountsUpdate,
    db: DbDep,
    user: BusinessManagerUser,
) -> list[PartnerBusinessAccountOut]:
    business = await _business_or_404(db, business_id)
    try:
        accounts = await map_svc.replace_business_accounts(
            db, business, body.user_ids, granted_by=user.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        db,
        entity_type="partner_business",
        entity_id=str(business.id),
        action="partner_map.business_accounts_update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新「{business.name}」店家帳號",
    )
    return [_account_out(account) for account in accounts]


@router.patch(
    "/admin/businesses/{business_id}",
    response_model=PartnerBusinessOut,
    summary="更新特約店家",
)
async def admin_update_business(
    business_id: uuid.UUID,
    body: PartnerBusinessUpdate,
    db: DbDep,
    user: BusinessManagerUser,
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    try:
        business = await map_svc.update_business(db, business, body)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="partner_business",
        entity_id=str(business.id),
        action="partner_map.business_update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新特約店家「{business.name}」",
    )
    return _business_out(business, include_private=True, include_internal=True)


@router.delete(
    "/admin/businesses/{business_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約店家",
)
async def admin_delete_business(
    business_id: uuid.UUID, db: DbDep, user: BusinessManagerUser
) -> None:
    business = await _business_or_404(db, business_id)
    await audit_svc.record(
        db,
        entity_type="partner_business",
        entity_id=str(business.id),
        action="partner_map.business_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"刪除特約店家「{business.name}」",
    )
    storage_keys = await map_svc.delete_business(db, business)
    for storage_key in storage_keys:
        await get_storage().delete(storage_key)


@router.get(
    "/admin/submissions",
    response_model=list[PartnerSubmissionOut],
    summary="管理端列出店家投稿",
)
async def admin_list_submissions(
    db: DbDep,
    _: SubmissionReviewerUser,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[PartnerSubmissionOut]:
    return [
        PartnerSubmissionOut.model_validate(submission)
        for submission in await map_svc.list_submissions(
            db, status_filter=status_filter, limit=limit, offset=offset
        )
    ]


@router.patch(
    "/admin/submissions/{submission_id}",
    response_model=PartnerSubmissionOut,
    summary="審核店家投稿",
)
async def admin_review_submission(
    submission_id: uuid.UUID,
    body: PartnerSubmissionReview,
    db: DbDep,
    user: SubmissionReviewerUser,
) -> PartnerSubmissionOut:
    submission = await map_svc.get_submission(db, submission_id)
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此投稿")
    if body.business_id is not None and await map_svc.get_business(db, body.business_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="指定店家不存在"
        )
    submission = await map_svc.review_submission(db, submission, body, user.id)
    return PartnerSubmissionOut.model_validate(submission)


@router.get("/admin/tags", response_model=list[PartnerTagOut], summary="管理端列出標籤")
async def admin_list_tags(db: DbDep, _: BusinessManagerUser) -> list[PartnerTag]:
    return await map_svc.list_tags(db, include_inactive=True)


@router.post(
    "/admin/tags",
    response_model=PartnerTagOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立特約標籤",
)
async def admin_create_tag(body: PartnerTagCreate, db: DbDep, _: BusinessManagerUser) -> PartnerTag:
    return await map_svc.create_tag(db, body)


@router.patch("/admin/tags/{tag_id}", response_model=PartnerTagOut, summary="更新特約標籤")
async def admin_update_tag(
    tag_id: uuid.UUID, body: PartnerTagUpdate, db: DbDep, _: BusinessManagerUser
) -> PartnerTag:
    return await map_svc.update_tag(db, await _tag_or_404(db, tag_id), body)


@router.delete(
    "/admin/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約標籤",
)
async def admin_delete_tag(tag_id: uuid.UUID, db: DbDep, _: BusinessManagerUser) -> None:
    await map_svc.delete_tag(db, await _tag_or_404(db, tag_id))


@router.post(
    "/admin/locations/parse-google-maps",
    response_model=PartnerGoogleMapsParseOut,
    summary="解析 Google Maps 據點連結",
)
async def admin_parse_google_maps_link(
    body: PartnerGoogleMapsParseIn, _: BusinessManagerUser
) -> PartnerGoogleMapsParseOut:
    try:
        parsed = await map_svc.parse_google_maps_link(body.url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return PartnerGoogleMapsParseOut.model_validate(parsed)


@router.post(
    "/admin/businesses/{business_id}/locations",
    response_model=PartnerLocationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增特約點位",
)
async def admin_create_location(
    business_id: uuid.UUID,
    body: PartnerLocationCreate,
    db: DbDep,
    _: BusinessManagerUser,
) -> PartnerLocation:
    return await map_svc.create_location(db, await _business_or_404(db, business_id), body)


@router.patch(
    "/admin/locations/{location_id}",
    response_model=PartnerLocationOut,
    summary="更新特約點位",
)
async def admin_update_location(
    location_id: uuid.UUID,
    body: PartnerLocationUpdate,
    db: DbDep,
    _: BusinessManagerUser,
) -> PartnerLocation:
    return await map_svc.update_location(db, await _location_or_404(db, location_id), body)


@router.delete(
    "/admin/locations/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約點位",
)
async def admin_delete_location(location_id: uuid.UUID, db: DbDep, _: BusinessManagerUser) -> None:
    await map_svc.delete_location(db, await _location_or_404(db, location_id))


@router.post(
    "/admin/businesses/{business_id}/offers",
    response_model=PartnerOfferOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增特約優惠",
)
async def admin_create_offer(
    business_id: uuid.UUID,
    body: PartnerOfferCreate,
    db: DbDep,
    _: BusinessManagerUser,
) -> PartnerOfferOut:
    offer = await map_svc.create_offer(db, await _business_or_404(db, business_id), body)
    return _offer_out(offer, include_private=True)


@router.patch("/admin/offers/{offer_id}", response_model=PartnerOfferOut, summary="更新特約優惠")
async def admin_update_offer(
    offer_id: uuid.UUID,
    body: PartnerOfferUpdate,
    db: DbDep,
    _: BusinessManagerUser,
) -> PartnerOfferOut:
    offer = await map_svc.update_offer(db, await _offer_or_404(db, offer_id), body)
    return _offer_out(offer, include_private=True)


@router.delete(
    "/admin/offers/{offer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約優惠",
)
async def admin_delete_offer(offer_id: uuid.UUID, db: DbDep, _: BusinessManagerUser) -> None:
    await map_svc.delete_offer(db, await _offer_or_404(db, offer_id))
