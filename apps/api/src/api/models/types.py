"""Shared SQLAlchemy column types."""

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

JSONDict = JSON().with_variant(JSONB, "postgresql")
# list-of-string 欄位（ApiKey.scopes / WebhookSubscription.events 等）
# PG 用 JSONB 比 ARRAY 在 ORM 取值上更一致；SQLite 退回普通 JSON。
JSONList = JSON().with_variant(JSONB, "postgresql")
