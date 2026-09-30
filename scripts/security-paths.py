#!/usr/bin/env python3
"""對核准主機執行固定、低頻、只送 HEAD 的主動路徑枚舉。"""

from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

HOST = "hcca.tw"
INTERVAL_SECONDS = 45.0
MIN_PUBLIC_INTERVAL_SECONDS = 45.0
TIMEOUT_SECONDS = 10
PROBES = (
    ("/.env", "sensitive"),
    ("/.git/config", "sensitive"),
    ("/backup.zip", "sensitive"),
    ("/backup.tar.gz", "sensitive"),
    ("/db.sql", "sensitive"),
    ("/api/docs", "documentation"),
    ("/api/openapi.json", "documentation"),
    ("/docs", "documentation"),
    ("/openapi.json", "documentation"),
    ("/admin", "route"),
    ("/robots.txt", "public-metadata"),
    ("/sitemap.xml", "public-metadata"),
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve_target() -> list[str]:
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(HOST, 443)})
    if not addresses or not all(ipaddress.ip_address(item).is_global for item in addresses):
        raise ValueError("Approved public host did not resolve exclusively to public IPs")
    return addresses


def classify(kind: str, status: int, headers) -> str:
    if (
        status == 403
        or status == 429
        or status >= 500
        or 300 <= status < 400
        or headers.get("cf-mitigated", "").lower() == "challenge"
    ):
        return "incomplete"
    if kind in {"sensitive", "documentation"} and 200 <= status < 300:
        # HEAD only identifies a candidate; no body is fetched to verify its contents.
        return "review"
    return "observed"


def scan(*, interval: float = INTERVAL_SECONDS) -> dict:
    report = {
        "target": f"https://{HOST}",
        "method": "HEAD",
        "scope": (
            f"12 fixed paths; one request every {interval:g} seconds; "
            "no redirects, auth or response bodies"
        ),
        "started_at": datetime.now(UTC).isoformat(),
        "checks": [],
        "result": "incomplete",
    }
    try:
        resolve_target()
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report

    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        NoRedirect(),
    )
    for index, (path, kind) in enumerate(PROBES):
        if index:
            time.sleep(max(0, interval))
        request = urllib.request.Request(
            f"https://{HOST}{path}",
            headers={"User-Agent": "HCCA-Authorized-Active-Path-Check/1.0"},
            method="HEAD",
        )
        try:
            try:
                response = opener.open(request, timeout=TIMEOUT_SECONDS)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.status
                check = {
                    "path": path,
                    "status": status,
                    "outcome": classify(kind, status, response.headers),
                }
        except (OSError, urllib.error.URLError) as error:
            check = {"path": path, "error": type(error).__name__, "outcome": "incomplete"}
        report["checks"].append(check)
        if check["outcome"] == "incomplete":
            break

    outcomes = {check["outcome"] for check in report["checks"]}
    report["result"] = (
        "incomplete"
        if "incomplete" in outcomes or len(report["checks"]) != len(PROBES)
        else "review"
        if "review" in outcomes
        else "pass"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--interval",
        type=float,
        default=INTERVAL_SECONDS,
        help="seconds between public requests (minimum 45; default: 45)",
    )
    args = parser.parse_args()
    if not MIN_PUBLIC_INTERVAL_SECONDS <= args.interval <= 300:
        parser.error("--interval must be between 45 and 300 seconds")
    report = scan(interval=args.interval)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Active path probes: {report['result']} ({len(report['checks'])}/12 HEAD requests)")
    return {"pass": 0, "review": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
