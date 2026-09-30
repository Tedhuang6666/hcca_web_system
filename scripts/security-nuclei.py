#!/usr/bin/env python3
"""執行已審閱的兩個唯讀 nuclei 探針，核對請求完整性，只保留必要證據。"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {"https://hcca.tw/api/auth/me", "https://hcca.tw/api/notifications/inbox"}


def run_scan() -> dict:
    report = {"target": "https://hcca.tw", "result": "incomplete", "checks": [], "findings": []}
    with tempfile.TemporaryDirectory(prefix="hcca-nuclei-") as scratch:
        folder = Path(scratch)
        findings = folder / "findings.jsonl"
        trace = folder / "trace.jsonl"
        try:
            result = subprocess.run(
                [
                    "nuclei",
                    "-u",
                    "https://hcca.tw",
                    "-t",
                    str(ROOT / "security/nuclei/hcca-public.yaml"),
                    "-config",
                    "/dev/null",
                    "-duc",
                    "-ni",
                    "-dr",
                    "-rl",
                    "1",
                    "-c",
                    "1",
                    "-bs",
                    "1",
                    "-timeout",
                    "10",
                    "-retries",
                    "0",
                    "-no-stdin",
                    "-nc",
                    "-or",
                    "-ot",
                    "-silent",
                    "-jle",
                    str(findings),
                    "-tlog",
                    str(trace),
                ],
                capture_output=True,
                timeout=120,
                check=False,
            )
            report["exit_code"] = result.returncode
            for line in trace.read_text().splitlines():
                row = json.loads(line)
                report["checks"].append({"url": row["input"], "error": row.get("error")})
            for line in findings.read_text().splitlines():
                row = json.loads(line)
                report["findings"].append(
                    {"template": row.get("template-id"), "url": row.get("matched-at")}
                )
            if (
                result.returncode == 0
                and len(report["checks"]) == len(EXPECTED)
                and {row["url"] for row in report["checks"]} == EXPECTED
                and all(row["error"] == "none" for row in report["checks"])
            ):
                report["result"] = "findings" if report["findings"] else "pass"
        except (OSError, subprocess.TimeoutExpired, ValueError, KeyError) as error:
            report["error"] = type(error).__name__
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = run_scan()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Nuclei reviewed probes: {report['result']}")
    return {"pass": 0, "findings": 1, "incomplete": 2}[report["result"]]


if __name__ == "__main__":
    raise SystemExit(main())
