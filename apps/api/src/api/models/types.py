"""Shared SQLAlchemy column types."""

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

JSONDict = JSON().with_variant(JSONB, "postgresql")
