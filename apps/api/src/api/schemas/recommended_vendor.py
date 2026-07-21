"""推薦商家 API schemas。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from api.models.recommended_vendor import RecommendedVendorStatus


class RecommendedVendorProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    price_text: str | None = Field(None, max_length=80)
    image_url: str | None = None
    menu_url: str | None = None
    sort_order: int = 0
    is_active: bool = True


class RecommendedVendorProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    price_text: str | None = Field(None, max_length=80)
    image_url: str | None = None
    menu_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class RecommendedVendorProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    name: str
    description: str | None
    price_text: str | None
    image_url: str | None
    menu_url: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RecommendedVendorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    summary: str | None = Field(None, max_length=300)
    description: str | None = None
    category: str | None = Field(None, max_length=80)
    address: str | None = Field(None, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    google_maps_url: str | None = None
    business_hours_text: str | None = Field(None, max_length=300)
    contact_name: str | None = Field(None, max_length=100)
    contact_phone: str | None = Field(None, max_length=50)
    contact_email: EmailStr | None = None
    line_id: str | None = Field(None, max_length=100)
    social_url: str | None = None
    website_url: str | None = None
    ordering_instructions: str | None = None
    menu_url: str | None = None
    hygiene_inspection_date: date | None = None
    hygiene_inspection_expires_at: date | None = None
    hygiene_certificate_url: str | None = None
    hygiene_note: str | None = None
    status: RecommendedVendorStatus = RecommendedVendorStatus.DRAFT
    sort_order: int = 0
    is_active: bool = True
    internal_note: str | None = None
    products: list[RecommendedVendorProductCreate] = Field(default_factory=list)


class RecommendedVendorUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    summary: str | None = Field(None, max_length=300)
    description: str | None = None
    category: str | None = Field(None, max_length=80)
    address: str | None = Field(None, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    google_maps_url: str | None = None
    business_hours_text: str | None = Field(None, max_length=300)
    contact_name: str | None = Field(None, max_length=100)
    contact_phone: str | None = Field(None, max_length=50)
    contact_email: EmailStr | None = None
    line_id: str | None = Field(None, max_length=100)
    social_url: str | None = None
    website_url: str | None = None
    ordering_instructions: str | None = None
    menu_url: str | None = None
    hygiene_inspection_date: date | None = None
    hygiene_inspection_expires_at: date | None = None
    hygiene_certificate_url: str | None = None
    hygiene_note: str | None = None
    status: RecommendedVendorStatus | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    internal_note: str | None = None


class RecommendedVendorListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    summary: str | None
    category: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    google_maps_url: str | None
    business_hours_text: str | None
    contact_phone: str | None
    contact_email: str | None
    line_id: str | None
    menu_url: str | None
    hygiene_inspection_date: date | None
    hygiene_inspection_expires_at: date | None
    hygiene_verified: bool = False
    status: str
    sort_order: int
    is_active: bool
    product_count: int = 0
    created_at: datetime
    updated_at: datetime


class RecommendedVendorOut(RecommendedVendorListItem):
    description: str | None
    contact_name: str | None
    social_url: str | None
    website_url: str | None
    ordering_instructions: str | None
    hygiene_certificate_url: str | None
    hygiene_note: str | None
    internal_note: str | None = None
    created_by: uuid.UUID | None
    products: list[RecommendedVendorProductOut] = Field(default_factory=list)
