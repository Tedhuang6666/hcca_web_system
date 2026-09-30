#!/usr/bin/env python3
"""固定範圍、唯讀、限速的公開入口檢查；不保存 body、Cookie 或 token。"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import socket
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

PROBES = (
    ("/", "public"),
    ("/login", "public"),
    ("/api/auth/me", "private"),
    ("/api/notifications/inbox", "private"),
    ("/api/receivables?limit=1", "private"),
    ("/api/receivables/summary", "private"),
    ("/api/receivables/export.csv", "private"),
    ("/api/docs", "disabled"),
    ("/api/openapi.json", "disabled"),
)
ALLOWED_HOSTS = {"hcca.tw", "127.0.0.1", "localhost", "::1"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_target(target: str) -> str:
    parsed = urlsplit(target)
    if (
        parsed.hostname not in ALLOWED_HOSTS
        or parsed.scheme not in {"http", "https"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Target must be hcca.tw or loopback, without credentials, path or query")
    if parsed.hostname == "hcca.tw" and (
        parsed.scheme != "https" or parsed.port not in {None, 443}
    ):
        raise ValueError("Public target must use HTTPS port 443")
    return target.rstrip("/")


def resolve_target(target: str) -> list[str]:
    parsed = urlsplit(target)
    addresses = sorted(
        {row[4][0] for row in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    )
    if not addresses:
        raise ValueError("DNS returned no addresses")
    if parsed.hostname == "hcca.tw":
        if not all(ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError("Public target resolved to a non-public address")
    elif not all(ipaddress.ip_address(address).is_loopback for address in addresses):
        raise ValueError("Local target resolved outside loopback")
    return addresses


def classify(path: str, kind: str, status: int, headers, *, https: bool) -> dict:
    result = {"path": path, "status": status, "outcome": "pass", "findings": []}
    # A challenge, redirect, rate limit or server error cannot prove application protection.
    if status == 429 or status >= 500 or headers.get("cf-mitigated") == "challenge":
        result["outcome"] = "incomplete"
        return result
    if 300 <= status < 400 or status == 403:
        result["outcome"] = "incomplete"
        return result
    expected = {"public": {200}, "private": {401}, "disabled": {404}}[kind]
    if status not in expected:
        if 200 <= status < 300 and kind != "public":
            result["findings"].append(
                "unauthenticated-success-needs-validation"
                if kind == "private"
                else "documentation-exposed"
            )
        else:
            result["outcome"] = "incomplete"
    if kind == "public" and status == 200:
        if headers.get("X-Content-Type-Options", "").lower() != "nosniff":
            result["findings"].append("missing-nosniff")
        csp = headers.get("Content-Security-Policy", "")
        if not csp:
            result["findings"].append("missing-csp")
        if not headers.get("X-Frame-Options") and "frame-ancestors" not in csp.lower():
            result["findings"].append("missing-frame-protection")
        if not headers.get("Referrer-Policy"):
            result["findings"].append("missing-referrer-policy")
        hsts = headers.get("Strict-Transport-Security", "")
        if https and not re.search(r"max-age\s*=\s*[1-9][0-9]*", hsts, re.IGNORECASE):
            result["findings"].append("missing-hsts")
    if result["findings"]:
        result["outcome"] = "finding"
    return result


def scan(target: str, *, interval: float = 1.0) -> dict:
    target = validate_target(target)
    report = {
        "target": target,
        "started_at": datetime.now(UTC).isoformat(),
        "scope": "nine fixed GET paths; no redirects, login, body capture or active payloads",
        "checks": [],
        "result": "incomplete",
    }
    try:
        report["addresses"] = resolve_target(target)
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for index, (path, kind) in enumerate(PROBES):
        if index:
            time.sleep(max(0, interval))
        request = urllib.request.Request(
            target + path, headers={"User-Agent": "HCCA-Authorized-Security-Check/1.0"}
        )
        try:
            try:
                response = opener.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                check = classify(
                    path, kind, response.status, response.headers, https=target.startswith("https:")
                )
        except (OSError, urllib.error.URLError) as error:
            check = {"path": path, "outcome": "incomplete", "error": type(error).__name__}
        report["checks"].append(check)
        if (
            "error" in check
            or check.get("status") == 429
            or check.get("status", 0) >= 500
            or (check["outcome"] == "incomplete" and check.get("status") == 403)
        ):
            break
    outcomes = {check["outcome"] for check in report["checks"]}
    report["result"] = (
        "incomplete"
        if "incomplete" in outcomes
        else "findings"
        if "finding" in outcomes
        else "pass"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default="https://hcca.tw")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = scan(args.target)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Public baseline: {report['result']} ({len(report['checks'])}/{len(PROBES)} checks)")
    return {"pass": 0, "findings": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
