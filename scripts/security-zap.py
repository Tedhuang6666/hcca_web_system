#!/usr/bin/env python3
"""在專用 loopback 測試 DB 啟動 API，執行固定 ZAP 規則並只保留去敏摘要。"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
RULES = {
    "40012": "CrossSiteScriptingScanRule",
    "40018": "SqlInjectionScanRule",
    "40022": "SqlInjectionPostgreSqlTimingScanRule",
}


def test_environment(source: dict[str, str], scratch: Path) -> dict[str, str]:
    database = source.get("TEST_DATABASE_URL", "")
    redis = source.get("REDIS_URL", "")
    db, cache = urlsplit(database), urlsplit(redis)
    if (
        db.scheme != "postgresql+asyncpg"
        or db.hostname not in {"127.0.0.1", "localhost", "::1"}
        or not re.fullmatch(r"/[a-zA-Z0-9_]+_test", db.path)
        or db.query
        or db.fragment
        or cache.scheme != "redis"
        or cache.hostname not in {"127.0.0.1", "localhost", "::1"}
        or cache.query
        or cache.fragment
        or not re.fullmatch(r"/(?:[0-9]|1[0-5])", cache.path)
    ):
        raise ValueError("Requires dedicated loopback PostgreSQL *_test and Redis database")
    # 不繼承應用 secrets；子程序 cwd 是沒有 .env 的私有暫存目錄。
    env = {key: source[key] for key in ("PATH", "LANG", "LD_LIBRARY_PATH") if key in source}
    env.update(
        DATABASE_URL=database,
        DATABASE_URL_SYNC=database.replace("postgresql+asyncpg:", "postgresql+psycopg2:", 1),
        REDIS_URL=redis,
        REDIS_CACHE_URL=redis,
        REDIS_REALTIME_URL=redis,
        CELERY_BROKER_URL=redis,
        CELERY_RESULT_BACKEND=redis,
        SECRET_KEY=f"ci-zap-{secrets.token_urlsafe(48)}",
        ENVIRONMENT="testing",
        SENTRY_DSN="",
        POSTHOG_API_KEY="",
        OTEL_ENABLED="false",
        WS_PUBSUB_BACKEND="memory",
        WAF_ENABLED="false",
        RATE_LIMIT_ENABLED="false",
        LOAD_SHED_ENABLED="false",
        ACCESS_LOG_ENABLED="false",
        LOG_LEVEL="ERROR",
        STORAGE_BACKEND="local",
        STORAGE_LOCAL_DIR=str(scratch / "uploads"),
        ALLOWED_HOSTS='["127.0.0.1","localhost"]',
    )
    return env


def summarize(raw: dict, log: str, returncode: int, base: str) -> dict:
    completed = {}
    for rule_id, name in RULES.items():
        match = re.search(
            rf"completed host/plugin {re.escape(base)} \| {name} in .*? "
            r"with (\d+) message\(s\) sent and (\d+) alert\(s\) raised",
            log,
        )
        if match:
            completed[rule_id] = {"requests": int(match[1]), "alerts": int(match[2])}
    alerts = []
    sites = raw.get("site", [])
    valid_site = bool(sites) and all(site.get("@name") == base for site in sites)
    for site in sites:
        for alert in site.get("alerts", []):
            # 原始證據可能含 cookie／body，僅白名單式輸出 ID、等級與數量。
            alerts.append(
                {
                    "rule": int(alert["pluginid"]),
                    "risk": int(alert["riskcode"]),
                    "instances": len(alert.get("instances", [])),
                }
            )
    complete = (
        returncode in {0, 1, 2}
        and (returncode == 0 or any(item["risk"] >= 2 for item in alerts))
        and valid_site
        and len(completed) == len(RULES)
        and all(item["requests"] > 0 for item in completed.values())
        and "Job report finished" in log
        and "Job exitStatus finished" in log
        and "Automation plan errors:" not in log
    )
    result = "incomplete"
    if complete:
        result = "findings" if any(item["risk"] >= 2 for item in alerts) else "pass"
    return {"result": result, "rules": completed, "alerts": alerts}


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


def run(zap: Path, port: int) -> dict:
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="hcca-zap-") as directory:
        scratch = Path(directory)
        env = test_environment(dict(os.environ), scratch)
        command = [sys.executable, str(Path(__file__).resolve())]
        with (scratch / "api.log").open("w+") as api_log:
            subprocess.run(
                [*command, "--child", "migrate"],
                cwd=scratch,
                env=env,
                stdout=api_log,
                stderr=subprocess.STDOUT,
                check=True,
                timeout=120,
            )
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", port))
                listener.listen(128)
                api = subprocess.Popen(
                    [*command, "--child", "serve", "--fd", str(listener.fileno())],
                    cwd=scratch,
                    env=env,
                    pass_fds=(listener.fileno(),),
                    stdout=api_log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            try:
                opener = build_opener(ProxyHandler({}))
                for _ in range(60):
                    if api.poll() is not None:
                        raise RuntimeError("Isolated API exited")
                    try:
                        with opener.open(base + "/ready", timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Isolated API did not become ready")
                # 再檢查 child，避免連上已佔用 port 的其他服務。
                if api.poll() is not None:
                    raise RuntimeError("Isolated API did not own listening port")
                plan = (ROOT / "security/zap-local.json").read_text()
                plan = plan.replace("${BASE_URL}", base).replace("${REPORT_DIR}", directory)
                plan_path = scratch / "plan.yaml"
                plan_path.write_text(plan)
                with (scratch / "console.log").open("w+") as zap_log:
                    scan = subprocess.Popen(
                        [
                            str(zap.resolve()),
                            "-cmd",
                            "-dir",
                            str(scratch / "home"),
                            "-autorun",
                            str(plan_path),
                        ],
                        cwd=scratch,
                        stdout=zap_log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    try:
                        code = scan.wait(timeout=360)
                    finally:
                        stop(scan)
                raw = json.loads((scratch / "report.json").read_text())
                log = (scratch / "console.log").read_text() + (scratch / "home/zap.log").read_text()
                return summarize(raw, log, code, base)
            finally:
                stop(api)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zap", type=Path)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--output", type=Path, default=Path("security-reports/zap.json"))
    parser.add_argument("--child", choices=["migrate", "serve"], help=argparse.SUPPRESS)
    parser.add_argument("--fd", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.child:
        test_environment(
            {
                "TEST_DATABASE_URL": os.environ.get("DATABASE_URL", ""),
                "REDIS_URL": os.environ.get("REDIS_URL", ""),
            },
            Path.cwd(),
        )
    if args.child == "migrate":
        from alembic import command
        from alembic.config import Config

        config = Config(str(ROOT / "apps/api/alembic.ini"))
        config.set_main_option("script_location", str(ROOT / "apps/api/alembic"))
        command.upgrade(config, "head")
        return 0
    if args.child == "serve":
        import uvicorn

        if args.fd is None:
            parser.error("Internal server requires an inherited loopback socket")
        uvicorn.run("api.main:app", fd=args.fd, access_log=False)
        return 0
    if args.zap is None or not 1024 <= args.port <= 65535:
        parser.error("--zap and an unprivileged local port are required")
    try:
        report = run(args.zap, args.port)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, KeyError) as exc:
        # Exception 可能含 DB URL／密碼，因此只輸出類型。
        report = {"result": "incomplete", "error_type": type(exc).__name__}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return {"pass": 0, "findings": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
