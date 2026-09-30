#!/usr/bin/env python3
"""以 ffuf 對核准主機執行限速、固定清單的 HEAD 路徑 fuzz。"""

from __future__ import annotations

import argparse
import base64
import binascii
import ipaddress
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

HOST = "hcca.tw"
WORDLIST = Path(__file__).with_name("security-fuzz-paths.txt")
FFUF_BINARY = Path.home() / ".local" / "bin" / "ffuf"
FFUF_VERSION = "2.3.0"
INTERVAL_SECONDS = 45.0
MIN_PUBLIC_INTERVAL_SECONDS = 45.0
MAX_PUBLIC_INTERVAL_SECONDS = 300.0
REQUEST_TIMEOUT_SECONDS = 10
BATCH_SIZE = 6
BATCH_START_INTERVAL_SECONDS = 310.0
BATCH_TIMEOUT_SECONDS = 320
CONTROL_PATH = "/robots.txt"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FfufOutputError(ValueError):
    def __init__(self, reason: str, checks: list[dict]):
        super().__init__(reason)
        self.reason = reason
        self.checks = checks


def load_paths(wordlist: Path = WORDLIST) -> list[str]:
    paths = [
        line.strip() for line in wordlist.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    if not paths or len(paths) != len(set(paths)):
        raise ValueError("Empty or duplicate fuzz wordlist")
    if any(
        path.startswith("/")
        or ".." in path.split("/")
        or "?" in path
        or "#" in path
        or "://" in path
        or any(ord(char) < 32 for char in path)
        for path in paths
    ):
        raise ValueError("Fuzz wordlist contains an unsafe path")
    return paths


def resolve_target() -> list[str]:
    addresses = sorted(
        {row[4][0] for row in socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)}
    )
    if not addresses or not all(
        ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in addresses
    ):
        raise ValueError("Approved public host did not resolve exclusively to public IPs")
    return addresses


def parse_results(stdout: str, paths: list[str]) -> list[dict]:
    expected = {index: path for index, path in enumerate(paths, start=1)}
    results: dict[int, dict] = {}

    def fail(reason: str):
        raise FfufOutputError(reason, [results[index] for index in sorted(results)])

    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            fail("InvalidJsonLine")
        if not isinstance(item, dict):
            fail("InvalidRecord")
        position = item.get("position")
        if type(position) is not int or position not in expected or position in results:
            fail("InvalidPosition")
        input_record = item.get("input")
        if not isinstance(input_record, dict):
            fail("InvalidInput")
        encoded_input = input_record.get("FUZZ")
        try:
            fuzz_value = base64.b64decode(encoded_input, validate=True).decode("utf-8")
        except (AttributeError, binascii.Error, TypeError, ValueError):
            fail("InvalidInput")
        if fuzz_value != expected[position]:
            fail("UnexpectedInput")
        status = item.get("status")
        length = item.get("length")
        if type(status) is not int or not 100 <= status <= 599:
            fail("InvalidStatus")
        if type(length) is not int or length < 0:
            fail("InvalidLength")
        outcome = (
            "incomplete"
            if status in {403, 429} or status >= 500 or 300 <= status < 400
            else "review"
            if 200 <= status < 300 or status in {401, 405}
            else "observed"
        )
        results[position] = {
            "path": f"/{fuzz_value}",
            "status": status,
            "response_length": length,
            "content_type": str(item.get("content-type", ""))[:128],
            "outcome": outcome,
        }
    if len(results) != len(paths):
        fail("IncompleteResults")
    return [results[index] for index in sorted(results)]


def probe_control(opener) -> dict:
    request = urllib.request.Request(
        f"https://{HOST}{CONTROL_PATH}",
        headers={"User-Agent": "HCCA-Authorized-Active-Fuzz-Control/1.0"},
        method="HEAD",
    )
    try:
        try:
            response = opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.status
            challenged = response.headers.get("cf-mitigated", "").lower() == "challenge"
    except (OSError, urllib.error.URLError) as error:
        return {"path": CONTROL_PATH, "outcome": "incomplete", "error": type(error).__name__}
    return {
        "path": CONTROL_PATH,
        "status": status,
        "outcome": "pass" if status == 200 and not challenged else "incomplete",
    }


def scan(
    *,
    interval: float = INTERVAL_SECONDS,
    wordlist: Path = WORDLIST,
    ffuf_binary: Path = FFUF_BINARY,
    runner=None,
    sleeper=None,
    monotonic=None,
) -> dict:
    runner = runner or subprocess.run
    sleeper = sleeper or time.sleep
    monotonic = monotonic or time.monotonic
    report = {
        "target": f"https://{HOST}",
        "tool": "ffuf",
        "version": FFUF_VERSION,
        "method": "HEAD",
        "scope": (
            "fixed reviewed wordlist; no auth, body download, recursion, redirects, or other hosts; "
            f"one request every {interval:g}s; at most {BATCH_SIZE} fuzz paths per 310s window"
        ),
        "started_at": datetime.now(UTC).isoformat(),
        "checks": [],
        "controls": [],
        "result": "incomplete",
    }
    try:
        paths = load_paths(wordlist)
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report
    if not MIN_PUBLIC_INTERVAL_SECONDS <= interval <= MAX_PUBLIC_INTERVAL_SECONDS:
        report["error"] = "InvalidInterval"
        return report
    if not ffuf_binary.is_file() or not os.access(ffuf_binary, os.X_OK):
        report["error"] = "FfufUnavailable"
        return report
    try:
        resolve_target()
    except (OSError, ValueError) as error:
        report["error"] = type(error).__name__
        return report

    environment = {
        "HOME": str(Path.home()),
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "Asia/Taipei",
    }
    try:
        version = runner(
            [str(ffuf_binary), "-V"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        report["error"] = type(error).__name__
        return report
    if version.returncode != 0 or FFUF_VERSION not in version.stdout:
        report["error"] = "UnexpectedFfufVersion"
        return report

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    batch_interval = max(
        BATCH_START_INTERVAL_SECONDS,
        interval * (BATCH_SIZE - 1) + (BATCH_SIZE + 1) * REQUEST_TIMEOUT_SECONDS + 10,
    )
    failed = False
    previous_batch_started = None
    with tempfile.TemporaryDirectory(prefix="hcca-ffuf-") as temp_dir:
        for batch_number, offset in enumerate(range(0, len(paths), BATCH_SIZE)):
            batch = paths[offset : offset + BATCH_SIZE]
            if previous_batch_started is not None:
                delay = batch_interval - (monotonic() - previous_batch_started)
                if delay > 0:
                    sleeper(delay)
            previous_batch_started = monotonic()
            chunk_wordlist = Path(temp_dir) / f"paths-{batch_number}.txt"
            chunk_wordlist.write_text("\n".join(batch) + "\n")
            chunk_timeout = max(
                BATCH_TIMEOUT_SECONDS,
                int(interval * (len(batch) - 1) + len(batch) * REQUEST_TIMEOUT_SECONDS + 30),
            )
            command = [
                str(ffuf_binary),
                "-config",
                "/dev/null",
                "-w",
                str(chunk_wordlist),
                "-u",
                f"https://{HOST}/FUZZ",
                "-X",
                "HEAD",
                "-t",
                "1",
                "-p",
                f"{interval:g}",
                "-timeout",
                str(REQUEST_TIMEOUT_SECONDS),
                "-maxtime",
                str(chunk_timeout),
                "-ignore-body",
                "-noninteractive",
                "-json",
                "-mc",
                "all",
                "-sa",
                "-s",
            ]
            try:
                completed = runner(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=chunk_timeout + 5,
                    check=False,
                    env=environment,
                )
                checks = parse_results(completed.stdout, batch)
            except FfufOutputError as error:
                report["checks"].extend(error.checks)
                report["checks"].append(
                    {
                        "batch": batch_number + 1,
                        "outcome": "incomplete",
                        "error": error.reason,
                    }
                )
                failed = True
                break
            except subprocess.TimeoutExpired as error:
                partial_stdout = error.stdout or ""
                if isinstance(partial_stdout, bytes):
                    partial_stdout = partial_stdout.decode("utf-8", "replace")
                if partial_stdout:
                    try:
                        partial = parse_results(partial_stdout, batch)
                    except FfufOutputError as output_error:
                        partial = output_error.checks
                    except ValueError:
                        partial = []
                    report["checks"].extend(partial)
                report["checks"].append(
                    {
                        "batch": batch_number + 1,
                        "outcome": "incomplete",
                        "error": type(error).__name__,
                    }
                )
                failed = True
                break
            except (OSError, ValueError) as error:
                report["checks"].append(
                    {
                        "batch": batch_number + 1,
                        "outcome": "incomplete",
                        "error": type(error).__name__,
                    }
                )
                failed = True
                break
            report["checks"].extend(checks)
            if completed.returncode != 0:
                report["checks"].append(
                    {
                        "batch": batch_number + 1,
                        "outcome": "incomplete",
                        "error": "FfufExitNonzero",
                    }
                )
                failed = True
                break
            if any(check["outcome"] == "incomplete" for check in checks):
                failed = True
                break

            control = probe_control(opener)
            report["controls"].append(control)
            if control["outcome"] != "pass":
                failed = True
                break

    report["result"] = (
        "complete" if not failed and len(report["checks"]) == len(paths) else "incomplete"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--interval",
        type=float,
        default=INTERVAL_SECONDS,
        help="seconds between public fuzz requests (minimum 45; default: 45)",
    )
    args = parser.parse_args()
    report = scan(interval=args.interval)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    args.output.chmod(0o600)
    candidates = sum(check.get("outcome") == "review" for check in report["checks"])
    print(
        f"Active ffuf path fuzz: {report['result']} ({len(report['checks'])} checks; {candidates} candidates)"
    )
    return {"complete": 0, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
