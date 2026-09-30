#!/usr/bin/env python3
"""對核准的公開搜尋入口執行低頻、唯讀主動探針；不保存回應本文。"""

from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path

HOST = "hcca.tw"
PATH = "/api/regulations/search"
INTERVAL_SECONDS = 10
BODY_LIMIT = 262_144


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve_target() -> list[str]:
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(HOST, 443)})
    if not addresses or not all(ipaddress.ip_address(item).is_global for item in addresses):
        raise ValueError("Approved public host did not resolve exclusively to public IPs")
    return addresses


def classify(status: int, content_type: str, marker_reflected: bool, body_truncated: bool) -> str:
    if marker_reflected or body_truncated:
        return "finding"
    if status == 200:
        return (
            "pass"
            if content_type in {"application/json", "application/problem+json"}
            else "finding"
        )
    if status == 400:
        # 400 表示輸入被拒絕；只記錄狀態，不推斷是應用或防護層所為。
        return "rejected"
    return "incomplete"


def scan() -> dict:
    report = {
        "target": f"{HOST}{PATH}",
        "method": "GET",
        "scope": "four fixed search probes; no login, writes, redirects or saved response bodies",
        "started_at": datetime.now(UTC).isoformat(),
        "checks": [],
        "result": "incomplete",
    }
    try:
        resolve_target()
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report

    marker = f"hcca-active-{uuid.uuid4().hex}"
    probes = (
        ("control", marker),
        ("sql-quote", marker + "'"),
        ("sql-boolean", marker + "' OR '1'='1'--"),
        ("xss-reflection", marker + "<svg/onload=alert(1)>"),
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    should_stop = False
    for index, (name, keyword) in enumerate(probes):
        if index:
            time.sleep(INTERVAL_SECONDS)
        url = "https://" + HOST + PATH + "?" + urllib.parse.urlencode({"keyword": keyword})
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "HCCA-Authorized-Active-Test/1.0"},
            method="GET",
        )
        started = time.monotonic()
        try:
            try:
                response = opener.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(BODY_LIMIT + 1)
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                status = response.status
                check = {
                    "probe": name,
                    "status": status,
                    "content_type": content_type,
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                    "body_bytes_checked": min(len(body), BODY_LIMIT),
                    "body_truncated": len(body) > BODY_LIMIT,
                    "marker_reflected": marker.encode() in body,
                    "outcome": "pending",
                }
                check["outcome"] = classify(
                    status,
                    content_type,
                    check["marker_reflected"],
                    check["body_truncated"],
                )
        except (OSError, urllib.error.URLError) as error:
            check = {"probe": name, "error": type(error).__name__, "outcome": "incomplete"}
            should_stop = True
        report["checks"].append(check)
        if should_stop:
            break
        if check["outcome"] == "finding" or check["outcome"] == "incomplete":
            should_stop = True

    outcomes = {item["outcome"] for item in report["checks"]}
    report["result"] = (
        "incomplete"
        if "incomplete" in outcomes or len(report["checks"]) != len(probes)
        else "findings"
        if "finding" in outcomes
        else "pass"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = scan()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Active security probes: {report['result']} ({len(report['checks'])}/4 requests)")
    return {"pass": 0, "findings": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
