#!/usr/bin/env python3
"""Fail quickly when API test PostgreSQL or Redis endpoints are unreachable."""

from __future__ import annotations

import os
import socket
import sys
from urllib.parse import urlsplit

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def check_endpoint(name: str, url: str, schemes: set[str], default_port: int) -> bool:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        port = default_port if parsed.port is None else parsed.port
    except ValueError:
        print(f"FAIL {name}: endpoint URL is invalid.", file=sys.stderr)
        return False

    if (
        parsed.scheme not in schemes
        or host not in LOOPBACK_HOSTS
        or not 1 <= port <= 65535
        or parsed.query
        or parsed.fragment
    ):
        print(f"FAIL {name}: test endpoint must use loopback.", file=sys.stderr)
        return False

    try:
        with socket.create_connection((host, port), timeout=3):
            pass
    except OSError:
        print(f"FAIL {name}: no service is reachable at {host}:{port}.", file=sys.stderr)
        return False

    print(f"OK {name}: reachable at {host}:{port}")
    return True


def main() -> int:
    database_url = os.environ.get("TEST_DATABASE_URL", "")
    redis_url = os.environ.get("TEST_REDIS_URL", "")
    valid = check_endpoint("PostgreSQL test database", database_url, {"postgresql+asyncpg"}, 5432)
    valid &= check_endpoint("Redis test service", redis_url, {"redis"}, 6379)
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
