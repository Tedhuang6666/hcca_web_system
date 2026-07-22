"""特約地圖業務邏輯"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from urllib.parse import parse_qs, unquote, urljoin, urlparse, urlunsplit

import httpx
from sqlalchemy import Select, and_, desc, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.search import like_contains
from api.models.partner_map import (
    PartnerBusiness,
    PartnerBusinessListingType,
    PartnerBusinessStatus,
    PartnerLocation,
    PartnerOffer,
    PartnerRating,
    PartnerSubmission,
    PartnerTag,
    partner_business_tags,
)
from api.schemas.partner_map import (
    PartnerBusinessCreate,
    PartnerBusinessUpdate,
    PartnerLocationCreate,
    PartnerLocationUpdate,
    PartnerOfferCreate,
    PartnerOfferUpdate,
    PartnerRatingCreate,
    PartnerSubmissionCreate,
    PartnerSubmissionReview,
    PartnerTagCreate,
    PartnerTagUpdate,
)
from api.services._base import apply_updates


def active_offer_clause(now: datetime | None = None):
    now = now or datetime.now(UTC)
    return and_(
        PartnerOffer.is_active == True,  # noqa: E712
        or_(PartnerOffer.starts_at == None, PartnerOffer.starts_at <= now),  # noqa: E711
        or_(PartnerOffer.ends_at == None, PartnerOffer.ends_at >= now),  # noqa: E711
    )


_GOOGLE_SHORT_HOSTS = {"maps.app.goo.gl", "goo.gl"}
_MAX_GOOGLE_REDIRECTS = 5


def _trusted_google_maps_host(host: str | None) -> str | None:
    host = (host or "").lower().rstrip(".")
    if host == "maps.app.goo.gl":
        return "maps.app.goo.gl"
    if host == "goo.gl":
        return "goo.gl"
    if host == "google.com":
        return "google.com"
    if host == "maps.google.com":
        return "maps.google.com"
    if host == "www.google.com":
        return "www.google.com"
    return None


def _canonical_google_maps_url(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Google Maps 連結的連接埠格式不正確") from exc

    trusted_host = _trusted_google_maps_host(parsed.hostname)
    if (
        parsed.scheme != "https"
        or trusted_host is None
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
        or parsed.fragment
    ):
        raise ValueError("連結未導向 Google Maps")

    # Rebuild the authority from a fixed allowlisted host. User input can only
    # contribute path/query data and can never choose the outbound destination.
    return trusted_host, urlunsplit(("https", trusted_host, parsed.path, parsed.query, ""))


def _extract_coordinates(value: str) -> tuple[float, float] | None:
    patterns = (
        r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)",
        r"@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)",
        r"(?:^|[^\d-])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?:$|[^\d])",
    )
    for pattern in patterns:
        match = re.search(pattern, value)
        if not match:
            continue
        latitude, longitude = float(match.group(1)), float(match.group(2))
        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            return latitude, longitude
    return None


def _looks_like_address(value: str) -> bool:
    return bool(re.search(r"\d", value) and re.search(r"[市縣區鄉鎮路街巷弄號段]", value))


def _extract_place_name(parsed_url) -> str | None:
    match = re.search(r"/maps/place/([^/@]+)", unquote(parsed_url.path))
    if not match:
        return None
    name = match.group(1).replace("+", " ").strip(" /")
    return name[:200] or None


def _extract_address(parsed_url) -> str | None:
    query_values = parse_qs(parsed_url.query).get("query", [])
    for value in query_values:
        address = unquote(value).replace("+", " ").strip()
        if address and _extract_coordinates(address) is None and _looks_like_address(address):
            return address[:300]
    return None


async def parse_google_maps_link(url: str) -> dict[str, str | float | None]:
    """展開 Google Maps 連結並擷取可直接建立據點的地址與座標。"""

    original = url.strip()
    host, resolved_url = _canonical_google_maps_url(original)

    if host in _GOOGLE_SHORT_HOSTS:
        try:
            async with httpx.AsyncClient(follow_redirects=False, timeout=8.0) as client:
                for _ in range(_MAX_GOOGLE_REDIRECTS):
                    response = await client.get(resolved_url)
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("Google Maps 短網址缺少導向位置")
                        next_url = urljoin(resolved_url, location)
                        _, resolved_url = _canonical_google_maps_url(next_url)
                        continue
                    response.raise_for_status()
                    break
                else:
                    raise ValueError("Google Maps 短網址導向次數過多")
        except (httpx.HTTPError, ValueError) as exc:
            raise ValueError("無法展開這個 Google Maps 短網址，請改貼完整連結") from exc

    _, resolved_url = _canonical_google_maps_url(resolved_url)
    parsed = urlparse(resolved_url)
    coordinates = _extract_coordinates(unquote(resolved_url))
    if coordinates is None:
        raise ValueError("連結中找不到座標，請從 Google Maps 的店家頁面重新複製分享連結")
    latitude, longitude = coordinates
    address = _extract_address(parsed)
    return {
        "google_maps_url": resolved_url,
        "name": _extract_place_name(parsed),
        "address": address,
        "latitude": latitude,
        "longitude": longitude,
    }


def _as_aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def is_offer_current(offer: PartnerOffer, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    if not offer.is_active:
        return False
    if offer.starts_at is not None and _as_aware(offer.starts_at) > now:
        return False
    return not (offer.ends_at is not None and _as_aware(offer.ends_at) < now)


async def _resolve_tags(db: AsyncSession, tag_ids: list[uuid.UUID]) -> list[PartnerTag]:
    if not tag_ids:
        return []
    result = await db.execute(select(PartnerTag).where(PartnerTag.id.in_(set(tag_ids))))
    tags = list(result.scalars().all())
    if len(tags) != len(set(tag_ids)):
        raise ValueError("部分指定的標籤不存在")
    return tags


def _business_options():
    return (
        selectinload(PartnerBusiness.tags),
        selectinload(PartnerBusiness.locations),
        selectinload(PartnerBusiness.offers),
        selectinload(PartnerBusiness.ratings),
    )


def rating_stats(business: PartnerBusiness) -> tuple[float | None, int]:
    ratings = [rating.rating for rating in business.ratings if rating.is_public]
    if not ratings:
        return None, 0
    return round(sum(ratings) / len(ratings), 1), len(ratings)


def popularity_score(business: PartnerBusiness) -> float:
    avg, count = rating_stats(business)
    rating_score = (avg or 0) * 12 + min(count, 30) * 2
    return round(
        business.view_count * 0.2
        + business.click_count * 0.7
        + business.checkin_count * 3
        + rating_score,
        1,
    )


async def list_tags(db: AsyncSession, *, include_inactive: bool = False) -> list[PartnerTag]:
    q = select(PartnerTag)
    if not include_inactive:
        q = q.where(PartnerTag.is_active == True)  # noqa: E712
    q = q.order_by(PartnerTag.sort_order, PartnerTag.name)
    result = await db.execute(q)
    return list(result.scalars().all())


async def create_tag(db: AsyncSession, data: PartnerTagCreate) -> PartnerTag:
    tag = PartnerTag(**data.model_dump())
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def update_tag(db: AsyncSession, tag: PartnerTag, data: PartnerTagUpdate) -> PartnerTag:
    original_name = tag.name
    apply_updates(tag, data)
    if data.name is not None and data.name != original_name:
        await db.execute(
            update(PartnerBusiness)
            .where(PartnerBusiness.category == original_name)
            .values(category=data.name)
        )
    await db.flush()
    await db.refresh(tag)
    return tag


async def get_tag(db: AsyncSession, tag_id: uuid.UUID) -> PartnerTag | None:
    return await db.get(PartnerTag, tag_id)


async def delete_tag(db: AsyncSession, tag: PartnerTag) -> None:
    await db.delete(tag)


async def create_business(
    db: AsyncSession, data: PartnerBusinessCreate, created_by: uuid.UUID | None
) -> PartnerBusiness:
    tags = await _resolve_tags(db, data.tag_ids)
    fields = data.model_dump(exclude={"tag_ids", "initial_offers", "initial_locations"})
    fields["status"] = str(fields["status"])
    business = PartnerBusiness(**fields, created_by=created_by)
    business.tags = tags
    business.locations = [
        PartnerLocation(**location.model_dump()) for location in data.initial_locations
    ]
    business.offers = [PartnerOffer(**offer.model_dump()) for offer in data.initial_offers]
    db.add(business)
    await db.flush()
    await db.refresh(business, ["tags", "locations", "offers", "ratings"])
    return business


async def update_business(
    db: AsyncSession, business: PartnerBusiness, data: PartnerBusinessUpdate
) -> PartnerBusiness:
    fields = data.model_dump(exclude_unset=True, exclude={"tag_ids"})
    for key, value in fields.items():
        setattr(business, key, str(value) if key == "status" and value is not None else value)
    if data.tag_ids is not None:
        business.tags = await _resolve_tags(db, data.tag_ids)
    await db.flush()
    await db.refresh(business, ["tags", "locations", "offers", "ratings"])
    return business


async def get_business(db: AsyncSession, business_id: uuid.UUID) -> PartnerBusiness | None:
    result = await db.execute(
        select(PartnerBusiness)
        .where(PartnerBusiness.id == business_id)
        .options(*_business_options())
    )
    return result.scalar_one_or_none()


async def list_businesses(
    db: AsyncSession,
    *,
    include_inactive: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[PartnerBusiness]:
    q = select(PartnerBusiness).options(*_business_options())
    if not include_inactive:
        q = q.where(PartnerBusiness.status == PartnerBusinessStatus.ACTIVE.value)
    q = q.order_by(PartnerBusiness.sort_order, PartnerBusiness.name).offset(offset).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().unique().all())


async def list_contact_businesses(
    db: AsyncSession,
    *,
    keyword: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PartnerBusiness]:
    q = (
        select(PartnerBusiness)
        .where(
            PartnerBusiness.status == PartnerBusinessStatus.ACTIVE.value,
            PartnerBusiness.listing_type == PartnerBusinessListingType.ONLINE.value,
        )
        .options(*_business_options())
    )
    if keyword:
        term = like_contains(keyword.strip())
        q = q.where(
            or_(
                PartnerBusiness.name.ilike(term),
                PartnerBusiness.summary.ilike(term),
                PartnerBusiness.description.ilike(term),
                PartnerBusiness.category.ilike(term),
                PartnerBusiness.contact_name.ilike(term),
                PartnerBusiness.contact_phone.ilike(term),
                PartnerBusiness.contact_email.ilike(term),
                PartnerBusiness.instagram_handle.ilike(term),
                PartnerBusiness.line_id.ilike(term),
                PartnerBusiness.other_contact.ilike(term),
            )
        )
    q = q.order_by(PartnerBusiness.sort_order, PartnerBusiness.name).offset(offset).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().unique().all())


async def delete_business(db: AsyncSession, business: PartnerBusiness) -> None:
    await db.delete(business)


async def discover_businesses(
    db: AsyncSession,
    *,
    listing_type: PartnerBusinessListingType | None = None,
    tag_ids: list[uuid.UUID] | None = None,
    keyword: str | None = None,
    has_active_offer: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[PartnerBusiness]:
    q = (
        select(PartnerBusiness)
        .where(PartnerBusiness.status == PartnerBusinessStatus.ACTIVE.value)
        .options(*_business_options())
    )
    if listing_type is not None:
        q = q.where(PartnerBusiness.listing_type == listing_type.value)
    if tag_ids:
        q = q.where(
            exists()
            .where(partner_business_tags.c.business_id == PartnerBusiness.id)
            .where(partner_business_tags.c.tag_id.in_(set(tag_ids)))
        )
    if keyword:
        term = like_contains(keyword.strip())
        q = q.where(
            or_(
                PartnerBusiness.name.ilike(term),
                PartnerBusiness.summary.ilike(term),
                PartnerBusiness.description.ilike(term),
                PartnerBusiness.category.ilike(term),
                PartnerBusiness.contact_name.ilike(term),
                PartnerBusiness.instagram_handle.ilike(term),
                PartnerBusiness.line_id.ilike(term),
            )
        )
    if has_active_offer:
        q = q.where(
            exists()
            .where(PartnerOffer.business_id == PartnerBusiness.id)
            .where(active_offer_clause())
        )
    q = q.order_by(PartnerBusiness.sort_order, PartnerBusiness.name).offset(offset).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().unique().all())


async def list_map_locations(
    db: AsyncSession,
    *,
    tag_ids: list[uuid.UUID] | None = None,
    keyword: str | None = None,
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lng: float | None = None,
    max_lng: float | None = None,
    has_active_offer: bool = False,
    limit: int = 200,
    offset: int = 0,
) -> list[PartnerLocation]:
    q: Select[tuple[PartnerLocation]] = (
        select(PartnerLocation)
        .join(PartnerLocation.business)
        .where(
            PartnerBusiness.status == PartnerBusinessStatus.ACTIVE.value,
            PartnerBusiness.listing_type == PartnerBusinessListingType.PHYSICAL.value,
            PartnerLocation.is_active == True,  # noqa: E712
        )
        .options(
            selectinload(PartnerLocation.business).selectinload(PartnerBusiness.tags),
            selectinload(PartnerLocation.business).selectinload(PartnerBusiness.offers),
            selectinload(PartnerLocation.business).selectinload(PartnerBusiness.ratings),
        )
    )
    if tag_ids:
        q = q.where(
            exists()
            .where(partner_business_tags.c.business_id == PartnerBusiness.id)
            .where(partner_business_tags.c.tag_id.in_(set(tag_ids)))
        )
    if keyword:
        term = like_contains(keyword.strip())
        q = q.where(
            or_(
                PartnerBusiness.name.ilike(term),
                PartnerBusiness.summary.ilike(term),
                PartnerBusiness.description.ilike(term),
                PartnerLocation.address.ilike(term),
                PartnerLocation.name.ilike(term),
            )
        )
    if min_lat is not None:
        q = q.where(PartnerLocation.latitude >= min_lat)
    if max_lat is not None:
        q = q.where(PartnerLocation.latitude <= max_lat)
    if min_lng is not None:
        q = q.where(PartnerLocation.longitude >= min_lng)
    if max_lng is not None:
        q = q.where(PartnerLocation.longitude <= max_lng)
    if has_active_offer:
        q = q.where(
            exists()
            .where(PartnerOffer.business_id == PartnerBusiness.id)
            .where(active_offer_clause())
        )
    q = (
        q.order_by(PartnerBusiness.sort_order, PartnerBusiness.name, PartnerLocation.sort_order)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(q)
    return list(result.scalars().unique().all())


async def increment_business_metric(
    db: AsyncSession, business: PartnerBusiness, metric: str
) -> PartnerBusiness:
    if metric == "view":
        business.view_count += 1
    elif metric == "click":
        business.click_count += 1
    elif metric == "checkin":
        business.checkin_count += 1
    else:
        raise ValueError("不支援的統計類型")
    await db.flush()
    await db.refresh(business, ["tags", "locations", "offers", "ratings"])
    return business


async def create_location(
    db: AsyncSession, business: PartnerBusiness, data: PartnerLocationCreate
) -> PartnerLocation:
    location = PartnerLocation(business_id=business.id, **data.model_dump())
    db.add(location)
    await db.flush()
    await db.refresh(location)
    return location


async def get_location(db: AsyncSession, location_id: uuid.UUID) -> PartnerLocation | None:
    return await db.get(PartnerLocation, location_id)


async def update_location(
    db: AsyncSession, location: PartnerLocation, data: PartnerLocationUpdate
) -> PartnerLocation:
    apply_updates(location, data)
    await db.flush()
    await db.refresh(location)
    return location


async def delete_location(db: AsyncSession, location: PartnerLocation) -> None:
    await db.delete(location)


async def create_offer(
    db: AsyncSession, business: PartnerBusiness, data: PartnerOfferCreate
) -> PartnerOffer:
    offer = PartnerOffer(business_id=business.id, **data.model_dump())
    db.add(offer)
    await db.flush()
    await db.refresh(offer)
    return offer


async def get_offer(db: AsyncSession, offer_id: uuid.UUID) -> PartnerOffer | None:
    return await db.get(PartnerOffer, offer_id)


async def update_offer(
    db: AsyncSession, offer: PartnerOffer, data: PartnerOfferUpdate
) -> PartnerOffer:
    apply_updates(offer, data)
    await db.flush()
    await db.refresh(offer)
    return offer


async def delete_offer(db: AsyncSession, offer: PartnerOffer) -> None:
    await db.delete(offer)


def active_offer_count(business: PartnerBusiness) -> int:
    return sum(1 for offer in business.offers if is_offer_current(offer))


async def count_active_offers(db: AsyncSession, business_id: uuid.UUID) -> int:
    value = await db.scalar(
        select(func.count(PartnerOffer.id)).where(
            PartnerOffer.business_id == business_id,
            active_offer_clause(),
        )
    )
    return int(value or 0)


async def upsert_rating(
    db: AsyncSession,
    business: PartnerBusiness,
    data: PartnerRatingCreate,
    user_id: uuid.UUID | None,
) -> PartnerRating:
    rating: PartnerRating | None = None
    if user_id is not None:
        result = await db.execute(
            select(PartnerRating).where(
                PartnerRating.business_id == business.id,
                PartnerRating.user_id == user_id,
            )
        )
        rating = result.scalar_one_or_none()
    if rating is None:
        rating = PartnerRating(business_id=business.id, user_id=user_id)
        db.add(rating)
    rating.rating = data.rating
    rating.comment = data.comment
    rating.visit_count = data.visit_count
    rating.is_public = data.is_public
    await db.flush()
    await db.refresh(rating)
    return rating


async def list_ratings(
    db: AsyncSession, business_id: uuid.UUID, *, limit: int = 20, offset: int = 0
) -> list[PartnerRating]:
    result = await db.execute(
        select(PartnerRating)
        .where(PartnerRating.business_id == business_id, PartnerRating.is_public == True)  # noqa: E712
        .order_by(PartnerRating.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def create_submission(
    db: AsyncSession, data: PartnerSubmissionCreate, submitted_by: uuid.UUID | None
) -> PartnerSubmission:
    submission = PartnerSubmission(**data.model_dump(), submitted_by=submitted_by)
    db.add(submission)
    await db.flush()
    await db.refresh(submission)
    return submission


async def list_submissions(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PartnerSubmission]:
    q = select(PartnerSubmission)
    if status_filter:
        q = q.where(PartnerSubmission.status == status_filter)
    q = q.order_by(PartnerSubmission.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_submission(db: AsyncSession, submission_id: uuid.UUID) -> PartnerSubmission | None:
    return await db.get(PartnerSubmission, submission_id)


async def review_submission(
    db: AsyncSession,
    submission: PartnerSubmission,
    data: PartnerSubmissionReview,
    reviewer_id: uuid.UUID,
) -> PartnerSubmission:
    submission.status = str(data.status)
    submission.review_note = data.review_note
    submission.business_id = data.business_id
    submission.reviewed_by = reviewer_id
    submission.reviewed_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(submission)
    return submission


async def ranking(db: AsyncSession, *, limit: int = 10) -> list[PartnerBusiness]:
    result = await db.execute(
        select(PartnerBusiness)
        .where(
            PartnerBusiness.status == PartnerBusinessStatus.ACTIVE.value,
            PartnerBusiness.listing_type == PartnerBusinessListingType.PHYSICAL.value,
        )
        .options(*_business_options())
        .order_by(desc(PartnerBusiness.checkin_count), desc(PartnerBusiness.view_count))
        .limit(limit)
    )
    return sorted(
        list(result.scalars().unique().all()),
        key=lambda business: popularity_score(business),
        reverse=True,
    )
