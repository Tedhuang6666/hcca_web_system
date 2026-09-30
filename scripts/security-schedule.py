#!/usr/bin/env python3
"""以低頻、分時方式執行 HCCA 核准的主動安全探針。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIRECTORY = Path.home() / ".local" / "state" / "hcca-security"
SCANS = {
    "daily": (
        ("dns", "security-dns.py", (), 120),
        ("active-inputs", "security-active.py", (), 120),
        ("nuclei-auth", "security-nuclei.py", (), 180),
    ),
    "http-baseline": (("http-baseline", "security-baseline.py", ("--interval", "45"), 660),),
    "path-enumeration": (("path-enumeration", "security-paths.py", ("--interval", "45"), 720),),
}


def scanner_environment() -> dict[str, str]:
    """只傳送執行公開探針所需環境，不繼承應用程式或 CI secrets。"""
    return {
        "HOME": str(Path.home()),
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "Asia/Taipei",
        "PYTHONNOUSERSITE": "1",
        "PYTHONUNBUFFERED": "1",
    }


def run_mode(
    mode: str,
    *,
    report_dir: Path = REPORT_DIRECTORY,
    runner: Callable = subprocess.run,
    started_at: datetime | None = None,
) -> tuple[dict, int]:
    if mode not in SCANS:
        raise ValueError(f"unsupported scan mode: {mode}")
    if report_dir.is_symlink():
        raise ValueError("report directory must not be a symlink")
    report_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    report_dir.chmod(0o700)

    started_at = started_at or datetime.now(UTC)
    run_id = started_at.astimezone(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    summary = {
        "mode": mode,
        "started_at": started_at.astimezone(UTC).isoformat(),
        "result": "complete",
        "scans": [],
    }
    environment = scanner_environment()

    for name, filename, options, timeout in SCANS[mode]:
        output = report_dir / f"{run_id}-{name}.json"
        command = [
            sys.executable,
            str(ROOT / filename),
            *options,
            "--output",
            str(output),
        ]
        scan = {"name": name, "report": output.name, "result": "incomplete"}
        try:
            if output.is_symlink():
                raise OSError("report path is a symlink")
            completed = runner(
                command,
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            scan["exit_code"] = completed.returncode
            if completed.returncode != 0:
                scan["result"] = "review"
            elif not output.is_file():
                scan["error"] = "MissingReport"
                scan["result"] = "review"
            else:
                try:
                    payload = json.loads(output.read_text())
                except (OSError, ValueError):
                    scan["error"] = "InvalidReport"
                    scan["result"] = "review"
                else:
                    if not isinstance(payload, dict) or payload.get("result") not in {
                        "pass",
                        "complete",
                    }:
                        scan["error"] = "UnexpectedReportResult"
                        scan["result"] = "review"
                    else:
                        scan["result"] = "complete"
        except subprocess.TimeoutExpired:
            scan["error"] = "TimeoutExpired"
        except OSError as error:
            scan["error"] = type(error).__name__
        if output.exists() and not output.is_symlink():
            try:
                output.chmod(0o600)
            except OSError as error:
                scan["error"] = type(error).__name__
                scan["result"] = "review"
        if scan["result"] != "complete":
            summary["result"] = "review"
        summary["scans"].append(scan)
        print(f"{name}: {scan['result']} (report={output.name})")

    summary_path = report_dir / f"{run_id}-summary.json"
    if summary_path.is_symlink():
        raise ValueError("summary path must not be a symlink")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    summary_path.chmod(0o600)
    print(f"HCCA security schedule: {summary['result']} ({mode})")
    return summary, 0 if summary["result"] == "complete" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=sorted(SCANS), required=True)
    args = parser.parse_args()
    try:
        _, exit_code = run_mode(args.mode)
    except (OSError, ValueError) as error:
        parser.error(type(error).__name__)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
