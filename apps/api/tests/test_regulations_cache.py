"""
Unit tests for regulations cache key builder and invalidation helper.
These tests are pure Python and do not require a database.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from api.models.regulation import RegulationCategory
from api.routers.regulations import (
    build_public_regulations_cache_key,
    _invalidate_public_regulations_cache,
)


class TestBuildPublicRegulationsCacheKey:
    """Tests for the cache key builder function."""

    def test_key_changes_with_pagination(self):
        """Cache key should change when limit or offset changes."""
        org_id = uuid.uuid4()

        key1 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key2 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=100,
            offset=0,
        )
        key3 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=20,
        )

        assert key1 != key2, "Different limit should produce different keys"
        assert key1 != key3, "Different offset should produce different keys"
        assert key2 != key3, "Different limit+offset should produce different keys"

    def test_key_changes_with_category(self):
        """Cache key should change when category changes."""
        org_id = uuid.uuid4()

        key1 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key2 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.ORDINANCE,
            active_only=True,
            limit=20,
            offset=0,
        )

        assert key1 != key2, "Different category should produce different keys"

    def test_key_changes_with_active_only(self):
        """Cache key should change when active_only changes."""
        org_id = uuid.uuid4()

        key1 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key2 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=False,
            limit=20,
            offset=0,
        )

        assert key1 != key2, "Different active_only should produce different keys"

    def test_key_keeps_org_prefix(self):
        """Cache key should have org_id in prefix for efficient wildcard invalidation."""
        org_id = uuid.uuid4()

        key = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )

        assert key.startswith(f"reg:public:v1:org:{org_id}:"), (
            f"Key {key} does not start with expected prefix"
        )

    def test_all_org_key_has_all_prefix(self):
        """Cache key for org_id=None should use 'all' in prefix."""
        key = build_public_regulations_cache_key(
            org_id=None,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )

        assert key.startswith("reg:public:v1:org:all:"), (
            f"Key {key} does not start with 'all' prefix"
        )

    def test_key_is_deterministic(self):
        """Same inputs should always produce the same key."""
        org_id = uuid.uuid4()

        key1 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key2 = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )

        assert key1 == key2, "Same inputs should produce identical keys"

    def test_key_format_structure(self):
        """Cache key should follow the expected format."""
        org_id = uuid.uuid4()

        key = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )

        parts = key.split(":")
        assert len(parts) == 6, f"Key should have 6 parts, got {len(parts)}"
        assert parts[0] == "reg", "First part should be 'reg'"
        assert parts[1] == "public", "Second part should be 'public'"
        assert parts[2] == "v1", "Third part should be 'v1' (version)"
        assert parts[3] == "org", "Fourth part should be 'org'"
        assert parts[4] == str(org_id), "Fifth part should be org_id"
        assert len(parts[5]) == 16, "Digest should be 16 characters (SHA256 truncated)"

    def test_none_category_differs_from_specific(self):
        """None category (all) should produce different key from any specific category."""
        org_id = uuid.uuid4()

        key_all = build_public_regulations_cache_key(
            org_id=org_id,
            category=None,
            active_only=True,
            limit=20,
            offset=0,
        )
        key_proc = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.PROCEDURE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key_ord = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.ORDINANCE,
            active_only=True,
            limit=20,
            offset=0,
        )
        key_const = build_public_regulations_cache_key(
            org_id=org_id,
            category=RegulationCategory.CONSTITUTION,
            active_only=True,
            limit=20,
            offset=0,
        )

        assert key_all != key_proc
        assert key_all != key_ord
        assert key_all != key_const


class TestInvalidatePublicRegulationsCache:
    """Tests for the invalidation helper function."""

    @pytest.mark.asyncio
    async def test_invalidates_both_org_and_all(self):
        """Invaliation should call cache_invalidate for both org-specific and cross-org 'all'."""
        org_id = uuid.uuid4()

        with patch(
            "api.routers.regulations.cache_invalidate", new_callable=AsyncMock
        ) as invalidate:
            await _invalidate_public_regulations_cache(org_id)

            assert invalidate.await_count == 2, "Should call cache_invalidate twice"

            # Check first call: org-specific
            invalidate.assert_any_await(f"reg:public:v1:org:{org_id}:*")

            # Check second call: cross-org "all"
            invalidate.assert_any_await("reg:public:v1:org:all:*")

    @pytest.mark.asyncio
    async def test_different_org_ids_produce_different_invalidation(self):
        """Different org_ids should produce different org-specific invalidation patterns."""
        org_id1 = uuid.uuid4()
        org_id2 = uuid.uuid4()

        with patch(
            "api.routers.regulations.cache_invalidate", new_callable=AsyncMock
        ) as invalidate:
            await _invalidate_public_regulations_cache(org_id1)
            await _invalidate_public_regulations_cache(org_id2)

            calls = invalidate.await_args_list
            org_patterns = [
                call[0][0] for call in calls if "org:" in call[0][0] and call[0][0].endswith(":*")
            ]

            # Should have invalidated each org specifically
            assert f"reg:public:v1:org:{org_id1}:*" in org_patterns
            assert f"reg:public:v1:org:{org_id2}:*" in org_patterns
            # "all" pattern should be called twice (once per invalidation)
            assert org_patterns.count("reg:public:v1:org:all:*") == 2
