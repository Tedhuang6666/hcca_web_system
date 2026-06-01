"""公開官網 Pydantic schemas。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PublicSiteSettingsBase(BaseModel):
    site_title: str = Field(..., min_length=1, max_length=120)
    site_description: str | None = None
    hero_title: str = Field(..., min_length=1, max_length=120)
    hero_subtitle: str | None = None
    hero_image_url: str | None = None
    hero_image_alt: str | None = Field(None, max_length=200)
    about_title: str = Field(..., min_length=1, max_length=120)
    about_body_md: str = Field(..., min_length=1)
    mission_md: str | None = None
    history_md: str | None = None
    cta_label: str = Field(..., min_length=1, max_length=60)
    cta_href: str = Field(..., min_length=1, max_length=500)
    public_database_label: str = Field(..., min_length=1, max_length=60)
    public_database_description: str | None = None
    theme_config: dict = Field(default_factory=dict)
    homepage_blocks: dict = Field(default_factory=dict)
    custom_css: str | None = None
    seo_title: str | None = Field(None, max_length=120)
    seo_description: str | None = Field(None, max_length=300)


class PublicSiteSettingsUpdate(BaseModel):
    site_title: str | None = Field(None, min_length=1, max_length=120)
    site_description: str | None = None
    hero_title: str | None = Field(None, min_length=1, max_length=120)
    hero_subtitle: str | None = None
    hero_image_url: str | None = None
    hero_image_alt: str | None = Field(None, max_length=200)
    about_title: str | None = Field(None, min_length=1, max_length=120)
    about_body_md: str | None = Field(None, min_length=1)
    mission_md: str | None = None
    history_md: str | None = None
    cta_label: str | None = Field(None, min_length=1, max_length=60)
    cta_href: str | None = Field(None, min_length=1, max_length=500)
    public_database_label: str | None = Field(None, min_length=1, max_length=60)
    public_database_description: str | None = None
    theme_config: dict | None = None
    homepage_blocks: dict | None = None
    custom_css: str | None = None
    seo_title: str | None = Field(None, max_length=120)
    seo_description: str | None = Field(None, max_length=300)


class PublicSiteSettingsOut(PublicSiteSettingsBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PublicLinkCategoryBase(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True


class PublicLinkCategoryCreate(PublicLinkCategoryBase):
    pass


class PublicLinkCategoryUpdate(BaseModel):
    slug: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PublicLinkCategoryOut(PublicLinkCategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PublicLinkBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=1, max_length=2000)
    description: str | None = None
    category_id: uuid.UUID | None = None
    icon_key: str | None = Field(None, max_length=40)
    sort_order: int = 0
    is_active: bool = True


class PublicLinkCreate(PublicLinkBase):
    pass


class PublicLinkUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=100)
    url: str | None = Field(None, min_length=1, max_length=2000)
    description: str | None = None
    category_id: uuid.UUID | None = None
    icon_key: str | None = Field(None, max_length=40)
    sort_order: int | None = None
    is_active: bool | None = None


class PublicLinkOut(PublicLinkBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: PublicLinkCategoryOut | None = None
    created_at: datetime
    updated_at: datetime


class PublicOfficerProfileBase(BaseModel):
    user_position_id: uuid.UUID
    display_name_override: str | None = Field(None, max_length=100)
    title_override: str | None = Field(None, max_length=120)
    bio: str | None = None
    public_email: str | None = Field(None, max_length=255)
    external_links: dict = Field(default_factory=dict)
    sort_order: int = 0
    is_featured: bool = False
    is_visible: bool = True


class PublicOfficerProfileCreate(PublicOfficerProfileBase):
    pass


class PublicOfficerProfileUpdate(BaseModel):
    user_position_id: uuid.UUID | None = None
    display_name_override: str | None = Field(None, max_length=100)
    title_override: str | None = Field(None, max_length=120)
    bio: str | None = None
    public_email: str | None = Field(None, max_length=255)
    external_links: dict | None = None
    sort_order: int | None = None
    is_featured: bool | None = None
    is_visible: bool | None = None


class PublicOfficerProfileOut(PublicOfficerProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PublicOfficerOut(BaseModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    user_position_id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    title: str
    org_name: str
    position_name: str
    avatar_url: str | None
    public_email: str | None
    bio: str | None
    external_links: dict
    start_date: date
    end_date: date | None
    sort_order: int
    is_featured: bool


class PublicOfficerCandidateOut(BaseModel):
    user_position_id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    email: str
    show_email: bool
    avatar_url: str | None
    org_id: uuid.UUID
    org_name: str
    position_id: uuid.UUID
    position_name: str
    start_date: date
    end_date: date | None
    has_public_profile: bool


class PublicSitePageBase(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str = Field(..., min_length=1, max_length=120)
    summary: str | None = None
    body_md: str = Field(..., min_length=1)
    page_kind: str = Field("standard", min_length=1, max_length=30)
    layout_config: dict = Field(default_factory=dict)
    content_blocks: dict = Field(default_factory=dict)
    cover_image_url: str | None = None
    cover_image_alt: str | None = Field(None, max_length=200)
    seo_title: str | None = Field(None, max_length=120)
    seo_description: str | None = Field(None, max_length=300)
    nav_label: str | None = Field(None, max_length=60)
    nav_order: int = 0
    sort_order: int = 0
    show_in_nav: bool = False
    is_published: bool = False


class PublicSitePageCreate(PublicSitePageBase):
    pass


class PublicSitePageUpdate(BaseModel):
    slug: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str | None = Field(None, min_length=1, max_length=120)
    summary: str | None = None
    body_md: str | None = Field(None, min_length=1)
    page_kind: str | None = Field(None, min_length=1, max_length=30)
    layout_config: dict | None = None
    content_blocks: dict | None = None
    cover_image_url: str | None = None
    cover_image_alt: str | None = Field(None, max_length=200)
    seo_title: str | None = Field(None, max_length=120)
    seo_description: str | None = Field(None, max_length=300)
    nav_label: str | None = Field(None, max_length=60)
    nav_order: int | None = None
    sort_order: int | None = None
    show_in_nav: bool | None = None
    is_published: bool | None = None


class PublicSitePageOut(PublicSitePageBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PublicSiteBundleOut(BaseModel):
    settings: PublicSiteSettingsOut
    links: list[PublicLinkOut]
    link_categories: list[PublicLinkCategoryOut]
    featured_officers: list[PublicOfficerOut]
    nav_pages: list[PublicSitePageOut]
