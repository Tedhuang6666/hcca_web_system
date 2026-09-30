#!/usr/bin/env python3
"""主動讀取核准網域的 robots.txt／sitemap.xml，只保存同網域路徑索引。"""

from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

HOST = "hcca.tw"
PATHS = ("/robots.txt", "/sitemap.xml")
INTERVAL_SECONDS = 45.0
MIN_PUBLIC_INTERVAL_SECONDS = 45.0
TIMEOUT_SECONDS = 15
BODY_LIMIT = 524_288
MAX_SITEMAP_URLS = 1_000
ALLOWED_METADATA_HOSTS = {HOST, "www.hcca.tw"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve_target() -> list[str]:
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(HOST, 443)})
    if not addresses or not all(
        ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in addresses
    ):
        raise ValueError("Approved public host did not resolve exclusively to public IPs")
    return addresses


def parse_robots(body: bytes) -> dict:
    directives = {"allow": [], "disallow": [], "sitemaps": []}
    external_hosts: set[str] = set()
    for line in body.decode("utf-8", "replace").splitlines():
        key, separator, value = line.partition(":")
        if not separator:
            continue
        name = key.strip().lower()
        value = value.strip()
        if name in {"allow", "disallow"}:
            directives[name].append(value)
        elif name == "sitemap":
            parsed = urlsplit(value)
            if parsed.hostname and parsed.hostname.lower() in ALLOWED_METADATA_HOSTS:
                directives["sitemaps"].append(parsed.path or "/")
            elif parsed.hostname:
                external_hosts.add(parsed.hostname.lower())
    return {
        **{key: sorted(set(values)) for key, values in directives.items()},
        "external_hosts_not_scanned": sorted(external_hosts),
    }


def parse_sitemap(body: bytes) -> dict:
    if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("UnsafeXmlDeclaration")
    root = ET.fromstring(body)
    paths: set[str] = set()
    external_hosts: set[str] = set()
    count = 0
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "loc" or not element.text:
            continue
        count += 1
        if count > MAX_SITEMAP_URLS:
            raise ValueError("SitemapUrlLimitExceeded")
        parsed = urlsplit(element.text.strip())
        hostname = parsed.hostname.lower() if parsed.hostname else None
        if hostname in ALLOWED_METADATA_HOSTS:
            paths.add(parsed.path or "/")
        elif hostname:
            external_hosts.add(hostname)
    return {
        "url_count": count,
        "site_paths": sorted(paths),
        "external_hosts_not_scanned": sorted(external_hosts),
    }


def scan(*, interval: float = INTERVAL_SECONDS) -> dict:
    report = {
        "target": f"https://{HOST}",
        "method": "GET robots.txt and sitemap.xml; no redirects or other host connections",
        "scope": f"two fixed public metadata paths; interval={interval:g}s; no response bodies saved",
        "started_at": datetime.now(UTC).isoformat(),
        "checks": [],
        "result": "incomplete",
    }
    try:
        resolve_target()
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    incomplete = False
    for index, path in enumerate(PATHS):
        if index:
            time.sleep(max(0, interval))
        request = urllib.request.Request(
            f"https://{HOST}{path}",
            headers={"User-Agent": "HCCA-Authorized-Active-Metadata/1.0"},
        )
        try:
            try:
                response = opener.open(request, timeout=TIMEOUT_SECONDS)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.status
                headers = response.headers
                body = response.read(BODY_LIMIT + 1) if status == 200 else b""
        except (OSError, urllib.error.URLError) as error:
            report["checks"].append(
                {"path": path, "outcome": "incomplete", "error": type(error).__name__}
            )
            incomplete = True
            break

        check = {"path": path, "status": status, "outcome": "observed"}
        if headers.get("cf-mitigated", "").lower() == "challenge":
            check["outcome"] = "incomplete"
            incomplete = True
        elif status == 200:
            if len(body) > BODY_LIMIT:
                check.update(outcome="incomplete", error="ResponseTooLarge")
                incomplete = True
            else:
                try:
                    check["inventory"] = (
                        parse_robots(body) if path == "/robots.txt" else parse_sitemap(body)
                    )
                except (ET.ParseError, ValueError) as error:
                    check.update(outcome="incomplete", error=type(error).__name__)
                    incomplete = True
        elif status in {403, 429} or status >= 500 or 300 <= status < 400:
            check["outcome"] = "incomplete"
            incomplete = True
        report["checks"].append(check)
        if incomplete:
            break

    report["result"] = (
        "incomplete" if incomplete or len(report["checks"]) != len(PATHS) else "complete"
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
    path_count = next(
        (
            len(check["inventory"].get("site_paths", []))
            for check in report["checks"]
            if check["path"] == "/sitemap.xml" and "inventory" in check
        ),
        0,
    )
    print(f"Active public metadata: {report['result']} ({path_count} same-site paths)")
    return {"complete": 0, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
