"""Create a disposable CI-only Playwright session for the migrated E2E database."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.engine import make_url

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.models.org import Org
from api.models.user import User
from api.routers.auth import _access_token_claims
from api.services.user_session import issue_session_tokens

E2E_USER_ID = UUID("3a53bd19-5145-4e65-946e-295809c80826")
E2E_USER_EMAIL = "hcca-e2e@example.invalid"
E2E_USER_NAME = "HCCA CI E2E"
E2E_ORG_ID = UUID("8416a3fa-9c9a-42d0-8a5d-1115692e4b77")
E2E_ORG_NAME = "HCCA CI E2E 組織"


def validate_target(output_path: Path) -> str:
    """Refuse to mint a privileged login outside the disposable local CI setup."""
    if os.getenv("CI", "").lower() != "true" or os.getenv("E2E_CI", "").lower() != "true":
        raise SystemExit("Refusing to create E2E auth state outside an explicitly marked CI run.")

    database_url = make_url(str(settings.DATABASE_URL))
    if (
        database_url.drivername.split("+")[0] not in {"postgres", "postgresql"}
        or database_url.host not in {"localhost", "127.0.0.1", "::1"}
        or not (database_url.database or "").endswith("_test")
    ):
        raise SystemExit(
            "Refusing to seed E2E identity outside a loopback *_test PostgreSQL database."
        )
    if os.getenv("ENVIRONMENT", "development").lower() in {"prod", "production"}:
        raise SystemExit("Refusing to create E2E auth state when ENVIRONMENT is production.")

    base_url = os.getenv("E2E_BASE_URL", "http://localhost:3000")
    parsed_base = urlsplit(base_url)
    if parsed_base.scheme != "http" or parsed_base.hostname not in {"localhost", "127.0.0.1"}:
        raise SystemExit(
            "E2E_BASE_URL must be an HTTP loopback URL so the test cookie stays local."
        )

    repo_root = Path(__file__).resolve().parents[3]
    resolved_output = output_path.expanduser().resolve()
    if resolved_output.is_relative_to(repo_root):
        raise SystemExit("E2E auth state must be written outside the repository.")

    return f"{parsed_base.scheme}://{parsed_base.netloc}"


async def create_storage_state(output_path: Path, origin: str) -> None:
    async with AsyncSessionLocal() as db:
        org = await db.get(Org, E2E_ORG_ID)
        if org is None:
            conflicting_org = await db.scalar(select(Org.id).where(Org.name == E2E_ORG_NAME))
            if conflicting_org is not None:
                raise RuntimeError("Reserved CI E2E organization name is already in use.")
            org = Org(id=E2E_ORG_ID, name=E2E_ORG_NAME, prefix="E2E", is_active=True)
            db.add(org)
        elif org.name != E2E_ORG_NAME:
            raise RuntimeError(
                "Reserved CI E2E organization id is already attached to another org."
            )
        org.is_active = True

        user = await db.get(User, E2E_USER_ID)
        if user is None:
            conflicting_user = await db.scalar(select(User.id).where(User.email == E2E_USER_EMAIL))
            if conflicting_user is not None:
                raise RuntimeError("Reserved CI E2E email is already attached to a different user.")
            user = User(
                id=E2E_USER_ID,
                email=E2E_USER_EMAIL,
                display_name=E2E_USER_NAME,
                is_active=True,
                is_verified=True,
                is_superuser=True,
            )
            db.add(user)
        elif user.email != E2E_USER_EMAIL:
            raise RuntimeError("Reserved CI E2E user id is already attached to a different email.")

        user.display_name = E2E_USER_NAME
        user.is_active = True
        user.is_verified = True
        user.is_superuser = True
        await db.flush()

        token_pair = await issue_session_tokens(
            db,
            user_id=user.id,
            extra_claims=await _access_token_claims(db, user),
            user_agent="Playwright CI",
            ip_address="127.0.0.1",
            auth_method="e2e",
        )
        await db.commit()

    now = int(time.time())
    same_site = settings.COOKIE_SAMESITE.capitalize()
    state = {
        "cookies": [
            {
                "name": settings.ACCESS_TOKEN_COOKIE_NAME,
                "value": token_pair.access_token,
                "url": origin,
                "expires": now + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                "httpOnly": True,
                "secure": settings.COOKIE_SECURE,
                "sameSite": same_site,
            },
            {
                "name": settings.REFRESH_TOKEN_COOKIE_NAME,
                "value": token_pair.refresh_token,
                "url": origin,
                "expires": now + settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
                "httpOnly": True,
                "secure": settings.COOKIE_SECURE,
                "sameSite": same_site,
            },
        ],
        "origins": [
            {
                "origin": origin,
                "localStorage": [{"name": "user_id", "value": str(E2E_USER_ID)}],
            }
        ],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    output_path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    origin = validate_target(args.output)
    asyncio.run(create_storage_state(args.output, origin))
    print("Created a short-lived Playwright login state for the isolated CI test database.")


if __name__ == "__main__":
    main()
