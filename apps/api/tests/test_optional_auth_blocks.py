"""封鎖帳號不能以可選登入端點保留私人資料存取權。"""

from datetime import UTC, datetime, timedelta

import pytest

from api.core.cache import cache_invalidate
from api.core.defense import publish_rules
from api.models.document import Document, DocumentStatus, DocumentVisibility
from api.models.org import Org
from api.models.user_identity import UserIdentity


@pytest.mark.parametrize("block_target", ["user", "primary_email", "linked_email"])
async def test_blocked_identity_loses_private_access_but_can_read_block_status(
    db_session, make_user, authed_client_factory, client, block_target
):
    owner = await make_user()
    other = await make_user()
    org = Org(name="Private document organization")
    other_org = Org(name="Unrelated organization")
    db_session.add_all([org, other_org])
    await db_session.flush()
    identity = UserIdentity(
        user_id=owner.id,
        provider="google",
        external_id=f"blocked-alias-{owner.id}",
        email=f"alias-{owner.id}@example.invalid",
        linked_at=datetime.now(UTC),
    )
    document = Document(
        serial_number=f"PRIVATE-{owner.id.hex[:16]}",
        title="Private control document",
        subject="Synthetic private test data",
        org_id=org.id,
        created_by=owner.id,
        status=DocumentStatus.DRAFT,
        visibility_level=DocumentVisibility.SUBJECT_ONLY,
    )
    other_document = Document(
        serial_number=f"PRIVATE-{other.id.hex[:16]}",
        title="Unrelated private control",
        org_id=other_org.id,
        created_by=other.id,
        status=DocumentStatus.DRAFT,
        visibility_level=DocumentVisibility.SUBJECT_ONLY,
    )
    db_session.add_all([identity, document, other_document])
    await db_session.flush()
    owner_client = authed_client_factory(owner)
    other_client = authed_client_factory(other)
    path = f"/documents/{document.id}"
    assert (await owner_client.get(path)).status_code == 200
    assert (await client.get(path)).status_code == 404
    rule_type, target = {
        "user": ("user_block", str(owner.id)),
        "primary_email": ("email_block", owner.email),
        "linked_email": ("email_block", identity.email),
    }[block_target]
    await publish_rules(
        [{"rule_type": rule_type, "target": target, "reason": "test block", "expires_at": None}]
    )
    try:
        assert (await owner_client.get("/auth/me")).status_code == 403
        assert (await owner_client.get(path)).status_code == 404
        assert (await owner_client.get(path + "/attachments")).status_code == 404
        status = await owner_client.get("/system/access-status")
        assert status.status_code == 200
        assert status.json()["blocked"] is True
        assert status.json()["reason"] == "test block"
        assert (await owner_client.get("/announcements")).status_code == 200
        assert (await other_client.get(f"/documents/{other_document.id}")).status_code == 200
    finally:
        await publish_rules([])
        await cache_invalidate("announcement:public-list:*")
    assert (await owner_client.get(path)).status_code == 200


async def test_expired_identity_block_keeps_authenticated_access(make_user, authed_client_factory):
    user = await make_user()
    ac = authed_client_factory(user)
    await publish_rules(
        [
            {
                "rule_type": "user_block",
                "target": str(user.id),
                "reason": "expired test block",
                "expires_at": (datetime.now(UTC) - timedelta(minutes=1)).timestamp(),
            }
        ]
    )
    try:
        assert (await ac.get("/auth/me")).status_code == 200
        assert (await ac.get("/system/access-status")).json()["blocked"] is False
    finally:
        await publish_rules([])
