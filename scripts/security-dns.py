#!/usr/bin/env python3
"""以固定字典對核准網域做低頻主動 DNS 發現；不連線至發現的主機。"""

from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import ssl
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import (
    HTTPRedirectHandler,
    HTTPSHandler,
    ProxyHandler,
    Request,
    build_opener,
)

HOST = "hcca.tw"
LABELS = (
    "www",
    "api",
    "app",
    "admin",
    "test",
    "staging",
    "dev",
    "status",
    "auth",
    "cdn",
    "static",
    "media",
    "posthug",
    "account",
    "accounts",
    "login",
    "sso",
    "oauth",
    "portal",
    "dashboard",
    "console",
    "manage",
    "management",
    "cms",
    "graphql",
    "v1",
    "v2",
    "api-v1",
    "api-v2",
    "docs",
    "help",
    "support",
    "mail",
    "webmail",
    "smtp",
    "ftp",
    "upload",
    "files",
    "downloads",
    "images",
    "assets",
    "service",
    "services",
    "gateway",
    "vpn",
    "remote",
    "mobile",
    "m",
    "beta",
    "preview",
    "qa",
    "uat",
    "sandbox",
    "dev-api",
    "stg",
    "prod",
    "monitor",
    "metrics",
    "health",
    "healthcheck",
    "backup",
    "legacy",
    "forum",
    "blog",
    "shop",
    "payment",
    "pay",
    "checkout",
    "webhook",
    "hooks",
    "ws",
    "websocket",
    "secure",
    "api-dev",
    "api-staging",
    "backend",
    "frontend",
    "web",
    "www2",
    "intranet",
    "staff",
    "student",
    "students",
    "member",
    "members",
    "union",
    "council",
    "assembly",
    "meetings",
    "election",
    "vote",
    "survey",
    "petition",
    "regulation",
    "document",
    "documents",
    "finance",
    "receivable",
    "receivables",
    "notification",
    "announcements",
    "storage",
    "git",
    "gitlab",
    "jenkins",
    "grafana",
    "prometheus",
    "kibana",
    "autodiscover",
    "imap",
    "mx1",
    "mx2",
    "meilisearch",
    "search",
    "db",
    "database",
    "api-docs",
    "swagger",
    "test1",
    "demo",
    "image",
    "webhooks",
    "internal",
)
CONTROL_PREFIX = "hcca-active-dns-control-"
INTERVAL_SECONDS = 1
DNS_OVER_HTTPS_URL = "https://cloudflare-dns.com/dns-query"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


DNS_OPENER = build_opener(
    ProxyHandler({}),
    NoRedirect(),
    HTTPSHandler(context=ssl.create_default_context()),
)


def resolve_cname(hostname: str) -> dict:
    query = urlencode({"name": hostname, "type": "CNAME"})
    request = Request(
        f"{DNS_OVER_HTTPS_URL}?{query}",
        headers={
            "accept": "application/dns-json",
            "user-agent": "HCCA-Authorized-DNS-Check/1.0",
        },
    )
    try:
        with DNS_OPENER.open(request, timeout=10) as response:
            body = response.read(8193)
            if len(body) > 8192:
                return {"status": "incomplete", "error": "ResponseTooLarge"}
            payload = json.loads(body)
    except (OSError, ValueError) as error:
        return {"status": "incomplete", "error": type(error).__name__}

    if payload.get("Status") != 0:
        return {"status": "incomplete", "error": "ResolverStatus"}

    targets = sorted(
        {
            answer["data"].rstrip(".").lower()
            for answer in payload.get("Answer", [])
            if answer.get("type") == 5 and isinstance(answer.get("data"), str)
        }
    )
    return {"status": "present", "targets": targets} if targets else {"status": "none"}


def resolve_hostname(hostname: str) -> dict:
    try:
        rows = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        if error.errno == socket.EAI_NONAME:
            return {"status": "nxdomain", "addresses": []}
        return {"status": "incomplete", "error": type(error).__name__}
    except OSError as error:
        return {"status": "incomplete", "error": type(error).__name__}

    addresses = sorted({row[4][0] for row in rows})
    if not addresses:
        return {"status": "incomplete", "error": "NoAddress"}
    if not all(ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in addresses):
        return {"status": "non-public", "addresses": []}
    return {"status": "resolved", "addresses": addresses}


def scan() -> dict:
    report = {
        "target": HOST,
        "method": "system A/AAAA resolution plus Cloudflare DoH CNAME lookup",
        "scope": (
            f"one root control, two random wildcard controls, {len(LABELS)} fixed labels; "
            "CNAME checked only for DNS-resolving candidates; "
            "no HTTP or port connections to discovered hosts"
        ),
        "started_at": datetime.now(UTC).isoformat(),
        "root": {},
        "wildcard_control": "not-run",
        "candidates": [],
        "result": "incomplete",
    }
    requests = 0

    def query(hostname: str) -> dict:
        nonlocal requests
        if requests:
            time.sleep(INTERVAL_SECONDS)
        requests += 1
        return resolve_hostname(hostname)

    root = query(HOST)
    report["root"] = {"status": root["status"]}
    if root["status"] != "resolved":
        report["error"] = root.get("error", root["status"])
        return report

    if not all(
        ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in root["addresses"]
    ):
        report["root"] = {"status": "non-public"}
        report["error"] = "NonPublicRoot"
        return report

    report["root"]["addresses"] = root["addresses"]
    wildcard_addresses: set[str] = set()
    wildcard_uncomparable = False
    review_required = False
    cname_incomplete = False
    controls = [f"{CONTROL_PREFIX}{uuid.uuid4().hex}.hcca.tw" for _ in range(2)]
    for hostname in controls:
        control = query(hostname)
        if control["status"] == "incomplete":
            report["wildcard_control"] = "incomplete"
            report["error"] = control["error"]
            return report
        if control["status"] == "non-public":
            wildcard_uncomparable = True
            review_required = True
        elif control["status"] == "resolved":
            wildcard_addresses.update(control["addresses"])

    wildcard_detected = bool(wildcard_addresses) or wildcard_uncomparable
    report["wildcard_control"] = "resolved" if wildcard_detected else "nxdomain"

    for label in LABELS:
        hostname = f"{label}.{HOST}"
        result = query(hostname)
        if result["status"] == "incomplete":
            report["error"] = result["error"]
            break
        if result["status"] == "non-public":
            report["candidates"].append({"hostname": hostname, "status": "non-public-address"})
            review_required = True
            continue
        if result["status"] == "resolved":
            addresses = result["addresses"]
            wildcard_match = wildcard_uncomparable or bool(
                wildcard_addresses.intersection(addresses)
            )
            candidate = {
                "hostname": hostname,
                "status": "wildcard-suspect" if wildcard_match else "dns-resolves",
                "addresses": addresses,
                "wildcard_address_overlap": wildcard_match,
            }
            cname = resolve_cname(hostname)
            candidate["cname_status"] = cname["status"]
            if cname["status"] == "present":
                candidate["cname_targets"] = cname["targets"]
            elif cname["status"] == "incomplete":
                candidate["cname_error"] = cname["error"]
                cname_incomplete = True
            report["candidates"].append(candidate)

    report["result"] = (
        "incomplete"
        if "error" in report or cname_incomplete
        else "review"
        if review_required
        else "complete"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = scan()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Active DNS discovery: {report['result']} ({len(report['candidates'])} candidates)")
    return {"complete": 0, "review": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
