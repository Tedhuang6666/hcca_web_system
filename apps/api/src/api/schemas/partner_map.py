"""特約地圖 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from api.models.partner_map import (
    PartnerBusinessListingType,
    PartnerBusinessStatus,
    PartnerOfferBenefitType,
    PartnerSubmissionStatus,
)


class PartnerTagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    color: str | None = Field(None, max_length=20)
    sort_order: int = 0
    is_active: bool = True


class PartnerTagUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    color: str | None = Field(None, max_length=20)
    sort_order: int | None = None
    is_active: bool | None = None


class PartnerTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PartnerLocationCreate(BaseModel):
    name: str | None = Field(None, max_length=200)
    address: str = Field(..., min_length=1, max_length=300)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    phone: str | None = Field(None, max_length=50)
    business_hours: dict = Field(default_factory=dict)
    google_place_id: str | None = Field(None, max_length=255)
    google_maps_url: str | None = Field(None, max_length=2000)
    sort_order: int = 0
    is_active: bool = True


class PartnerLocationUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    address: str | None = Field(None, min_length=1, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    phone: str | None = Field(None, max_length=50)
    business_hours: dict | None = None
    google_place_id: str | None = Field(None, max_length=255)
    google_maps_url: str | None = Field(None, max_length=2000)
    sort_order: int | None = None
    is_active: bool | None = None


class PartnerLocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    name: str | None
    address: str
    latitude: float
    longitude: float
    phone: str | None
    business_hours: dict
    google_place_id: str | None
    google_maps_url: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PartnerGoogleMapsParseIn(BaseModel):
    url: str = Field(..., min_length=1, max_length=2000)


class PartnerGoogleMapsParseOut(BaseModel):
    google_maps_url: str
    address: str
    latitude: float
    longitude: float


class PartnerOfferCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    benefit_type: PartnerOfferBenefitType = PartnerOfferBenefitType.OTHER
    benefit_value: str | None = Field(None, max_length=120)
    public_summary: str | None = Field(None, max_length=300)
    full_description: str | None = None
    instructions: str | None = None
    member_note: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int = 0
    is_active: bool = True


class PartnerOfferUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    benefit_type: PartnerOfferBenefitType | None = None
    benefit_value: str | None = Field(None, max_length=120)
    public_summary: str | None = Field(None, max_length=300)
    full_description: str | None = None
    instructions: str | None = None
    member_note: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PartnerOfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    title: str
    benefit_type: str
    benefit_value: str | None
    public_summary: str | None
    full_description: str | None
    instructions: str | None
    member_note: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    sort_order: int
    is_active: bool
    is_current: bool = False
    created_at: datetime
    updated_at: datetime


class PartnerBusinessCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    summary: str | None = Field(None, max_length=300)
    description: str | None = None
    website_url: str | None = None
    social_url: str | None = None
    logo_url: str | None = None
    cover_image_url: str | None = None
    category: str | None = Field(None, max_length=50)
    business_hours_text: str | None = Field(None, max_length=300)
    listing_type: PartnerBusinessListingType = PartnerBusinessListingType.PHYSICAL
    contact_name: str | None = Field(None, max_length=100)
    contact_phone: str | None = Field(None, max_length=50)
    contact_email: EmailStr | None = None
    instagram_handle: str | None = Field(None, max_length=100)
    line_id: str | None = Field(None, max_length=100)
    other_contact: str | None = None

    @field_validator("instagram_handle")
    @classmethod
    def normalize_instagram_handle(cls, value: str | None) -> str | None:
        return value.strip().lstrip("@").rstrip("/") if value else value

    status: PartnerBusinessStatus = PartnerBusinessStatus.DRAFT
    sort_order: int = 0
    internal_note: str | None = None
    tag_ids: list[uuid.UUID] = Field(default_factory=list)
    initial_offers: list[PartnerOfferCreate] = Field(default_factory=list, max_length=20)


class PartnerBusinessUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    summary: str | None = Field(None, max_length=300)
    description: str | None = None
    website_url: str | None = None
    social_url: str | None = None
    logo_url: str | None = None
    cover_image_url: str | None = None
    category: str | None = Field(None, max_length=50)
    business_hours_text: str | None = Field(None, max_length=300)
    listing_type: PartnerBusinessListingType | None = None
    contact_name: str | None = Field(None, max_length=100)
    contact_phone: str | None = Field(None, max_length=50)
    contact_email: EmailStr | None = None
    instagram_handle: str | None = Field(None, max_length=100)
    line_id: str | None = Field(None, max_length=100)
    other_contact: str | None = None

    @field_validator("instagram_handle")
    @classmethod
    def normalize_instagram_handle(cls, value: str | None) -> str | None:
        return value.strip().lstrip("@").rstrip("/") if value else value

    status: PartnerBusinessStatus | None = None
    sort_order: int | None = None
    internal_note: str | None = None
    tag_ids: list[uuid.UUID] | None = None


class PartnerBusinessListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    summary: str | None
    status: str
    logo_url: str | None
    cover_image_url: str | None = None
    category: str | None = None
    business_hours_text: str | None = None
    listing_type: str
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    instagram_handle: str | None = None
    line_id: str | None = None
    other_contact: str | None = None
    sort_order: int
    view_count: int = 0
    click_count: int = 0
    checkin_count: int = 0
    rating_avg: float | None = None
    rating_count: int = 0
    popularity_score: float = 0
    tags: list[PartnerTagOut] = []
    location_count: int = 0
    active_offer_count: int = 0
    created_at: datetime
    updated_at: datetime


class PartnerBusinessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    summary: str | None
    description: str | None
    website_url: str | None
    social_url: str | None
    logo_url: str | None
    cover_image_url: str | None
    category: str | None
    business_hours_text: str | None
    listing_type: str
    contact_name: str | None
    contact_phone: str | None
    contact_email: str | None
    instagram_handle: str | None
    line_id: str | None
    other_contact: str | None
    status: str
    sort_order: int
    view_count: int = 0
    click_count: int = 0
    checkin_count: int = 0
    rating_avg: float | None = None
    rating_count: int = 0
    popularity_score: float = 0
    internal_note: str | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    tags: list[PartnerTagOut] = []
    locations: list[PartnerLocationOut] = []
    offers: list[PartnerOfferOut] = []
    can_view_private_details: bool = False


class PartnerDiscoveryItem(BaseModel):
    """學生端優惠探索清單：讓實體與線上合作共用同一套入口。"""

    id: uuid.UUID
    name: str
    summary: str | None
    logo_url: str | None
    cover_image_url: str | None
    category: str | None
    listing_type: str
    tags: list[PartnerTagOut]
    location_count: int
    active_offer_count: int
    featured_offer_title: str | None
    featured_offer_benefit_type: str | None
    featured_offer_benefit_value: str | None


class PartnerMapItem(BaseModel):
    business_id: uuid.UUID
    location_id: uuid.UUID
    business_name: str
    location_name: str | None
    summary: str | None
    logo_url: str | None
    cover_image_url: str | None
    category: str | None
    business_hours_text: str | None
    address: str
    latitude: float
    longitude: float
    phone: str | None
    tags: list[PartnerTagOut]
    has_active_offer: bool
    active_offer_titles: list[str]
    rating_avg: float | None = None
    rating_count: int = 0
    popularity_score: float = 0
    view_count: int = 0
    checkin_count: int = 0


class PartnerRatingCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=1000)
    visit_count: int = Field(1, ge=0, le=999)
    is_public: bool = True


class PartnerRatingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    user_id: uuid.UUID | None
    rating: int
    comment: str | None
    visit_count: int
    is_public: bool
    created_at: datetime
    updated_at: datetime


class PartnerSubmissionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str | None = Field(None, max_length=50)
    address: str | None = Field(None, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    reason: str | None = None
    offer_hint: str | None = Field(None, max_length=300)
    contact_hint: str | None = Field(None, max_length=200)


class PartnerSubmissionReview(BaseModel):
    status: PartnerSubmissionStatus
    review_note: str | None = None
    business_id: uuid.UUID | None = None


class PartnerSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    reason: str | None
    offer_hint: str | None
    contact_hint: str | None
    status: str
    submitted_by: uuid.UUID | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    business_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PartnerRankingItem(BaseModel):
    business_id: uuid.UUID
    name: str
    summary: str | None
    category: str | None
    logo_url: str | None
    rating_avg: float | None
    rating_count: int
    checkin_count: int
    view_count: int
    popularity_score: float


class PartnerMapBounds(BaseModel):
    min_lat: float = Field(..., ge=-90, le=90)
    max_lat: float = Field(..., ge=-90, le=90)
    min_lng: float = Field(..., ge=-180, le=180)
    max_lng: float = Field(..., ge=-180, le=180)
