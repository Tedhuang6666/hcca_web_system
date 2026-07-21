"""特約地圖路由 - /partner-map"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_optional_user
from api.dependencies.permissions import require_permission
from api.models.partner_map import PartnerBusiness, PartnerLocation, PartnerOffer, PartnerTag
from api.models.user import User
from api.routers._common import or_404
from api.schemas.partner_map import (
    PartnerBusinessCreate,
    PartnerBusinessListItem,
    PartnerBusinessOut,
    PartnerBusinessUpdate,
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

router = APIRouter(prefix="/partner-map", tags=["特約地圖"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.PARTNER_MAP_MANAGE))]


def _offer_out(offer: PartnerOffer, *, include_private: bool) -> PartnerOfferOut:
    out = PartnerOfferOut.model_validate(offer)
    out.is_current = map_svc.is_offer_current(offer)
    if not include_private:
        out.full_description = None
        out.instructions = None
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
) -> PartnerBusinessOut:
    out = PartnerBusinessOut.model_validate(business)
    rating_avg, rating_count = map_svc.rating_stats(business)
    out.can_view_private_details = include_private
    out.internal_note = business.internal_note if include_internal else None
    out.rating_avg = rating_avg
    out.rating_count = rating_count
    out.popularity_score = map_svc.popularity_score(business)
    out.locations = (
        [
            _location_out(location, include_private=include_private)
            for location in business.locations
            if include_private or location.is_active
        ]
        if business.listing_type == "location"
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


def _map_item(location: PartnerLocation, *, include_private: bool) -> PartnerMapItem:
    business = location.business
    current_offers = [offer for offer in business.offers if map_svc.is_offer_current(offer)]
    rating_avg, rating_count = map_svc.rating_stats(business)
    return PartnerMapItem(
        business_id=business.id,
        location_id=location.id,
        business_name=business.name,
        location_name=location.name,
        summary=business.summary,
        logo_url=business.logo_url,
        cover_image_url=business.cover_image_url,
        category=business.category,
        business_hours_text=business.business_hours_text,
        address=location.address,
        latitude=location.latitude,
        longitude=location.longitude,
        phone=location.phone if include_private else None,
        tags=[PartnerTagOut.model_validate(tag) for tag in business.tags if tag.is_active],
        has_active_offer=bool(current_offers),
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
    return _business_out(business, include_private=viewer is not None)


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
    return _business_out(business, include_private=viewer is not None)


@router.post(
    "/businesses/{business_id}/check-in",
    response_model=PartnerBusinessOut,
    summary="記錄學生常去",
)
async def record_business_checkin(
    business_id: uuid.UUID, db: DbDep, viewer: OptionalUser
) -> PartnerBusinessOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    business = await map_svc.increment_business_metric(db, business, "checkin")
    return _business_out(business, include_private=viewer is not None)


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
    viewer: OptionalUser,
) -> PartnerRatingOut:
    business = await _business_or_404(db, business_id)
    if business.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約店家")
    rating = await map_svc.upsert_rating(db, business, body, viewer.id if viewer else None)
    return PartnerRatingOut.model_validate(rating)


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
    _: ManagerUser,
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
    body: PartnerBusinessCreate, db: DbDep, user: ManagerUser
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
    business_id: uuid.UUID, db: DbDep, _: ManagerUser
) -> PartnerBusinessOut:
    return _business_out(
        await _business_or_404(db, business_id), include_private=True, include_internal=True
    )


@router.patch(
    "/admin/businesses/{business_id}",
    response_model=PartnerBusinessOut,
    summary="更新特約店家",
)
async def admin_update_business(
    business_id: uuid.UUID, body: PartnerBusinessUpdate, db: DbDep, user: ManagerUser
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
async def admin_delete_business(business_id: uuid.UUID, db: DbDep, user: ManagerUser) -> None:
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
    await map_svc.delete_business(db, business)


@router.get(
    "/admin/submissions",
    response_model=list[PartnerSubmissionOut],
    summary="管理端列出店家投稿",
)
async def admin_list_submissions(
    db: DbDep,
    _: ManagerUser,
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
    user: ManagerUser,
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
async def admin_list_tags(db: DbDep, _: ManagerUser) -> list[PartnerTag]:
    return await map_svc.list_tags(db, include_inactive=True)


@router.post(
    "/admin/tags",
    response_model=PartnerTagOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立特約標籤",
)
async def admin_create_tag(body: PartnerTagCreate, db: DbDep, _: ManagerUser) -> PartnerTag:
    return await map_svc.create_tag(db, body)


@router.patch("/admin/tags/{tag_id}", response_model=PartnerTagOut, summary="更新特約標籤")
async def admin_update_tag(
    tag_id: uuid.UUID, body: PartnerTagUpdate, db: DbDep, _: ManagerUser
) -> PartnerTag:
    return await map_svc.update_tag(db, await _tag_or_404(db, tag_id), body)


@router.delete(
    "/admin/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約標籤",
)
async def admin_delete_tag(tag_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    await map_svc.delete_tag(db, await _tag_or_404(db, tag_id))


@router.post(
    "/admin/businesses/{business_id}/locations",
    response_model=PartnerLocationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增特約點位",
)
async def admin_create_location(
    business_id: uuid.UUID, body: PartnerLocationCreate, db: DbDep, _: ManagerUser
) -> PartnerLocation:
    return await map_svc.create_location(db, await _business_or_404(db, business_id), body)


@router.patch(
    "/admin/locations/{location_id}",
    response_model=PartnerLocationOut,
    summary="更新特約點位",
)
async def admin_update_location(
    location_id: uuid.UUID, body: PartnerLocationUpdate, db: DbDep, _: ManagerUser
) -> PartnerLocation:
    return await map_svc.update_location(db, await _location_or_404(db, location_id), body)


@router.delete(
    "/admin/locations/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約點位",
)
async def admin_delete_location(location_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    await map_svc.delete_location(db, await _location_or_404(db, location_id))


@router.post(
    "/admin/businesses/{business_id}/offers",
    response_model=PartnerOfferOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增特約優惠",
)
async def admin_create_offer(
    business_id: uuid.UUID, body: PartnerOfferCreate, db: DbDep, _: ManagerUser
) -> PartnerOfferOut:
    offer = await map_svc.create_offer(db, await _business_or_404(db, business_id), body)
    return _offer_out(offer, include_private=True)


@router.patch("/admin/offers/{offer_id}", response_model=PartnerOfferOut, summary="更新特約優惠")
async def admin_update_offer(
    offer_id: uuid.UUID, body: PartnerOfferUpdate, db: DbDep, _: ManagerUser
) -> PartnerOfferOut:
    offer = await map_svc.update_offer(db, await _offer_or_404(db, offer_id), body)
    return _offer_out(offer, include_private=True)


@router.delete(
    "/admin/offers/{offer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除特約優惠",
)
async def admin_delete_offer(offer_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    await map_svc.delete_offer(db, await _offer_or_404(db, offer_id))
