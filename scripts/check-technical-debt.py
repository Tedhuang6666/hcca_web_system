"""Report source debt and reject per-file increases against the reviewed baseline."""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "config/technical-debt-baseline.json"
SOURCE_ROOTS = ("apps/api/src/", "apps/web/src/", "libs/shared/src/")
GENERATED = {"api-types.ts", "api-bridge.ts"}
DB_METHODS = {"execute", "scalar", "scalars", "get"}


def python_metrics(source: str, *, router: bool, service: bool) -> dict[str, int]:
    tree = ast.parse(source)
    counts = {}
    queries = commits = exceptions = http_imports = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            receiver = node.func.value
            if isinstance(receiver, ast.Name) and receiver.id in {"db", "session"}:
                queries += router and node.func.attr in DB_METHODS
                commits += node.func.attr == "commit"
        elif isinstance(node, ast.ExceptHandler):
            exceptions += node.type is None or (
                isinstance(node.type, ast.Name) and node.type.id in {"Exception", "BaseException"}
            )
        elif service and isinstance(node, ast.ImportFrom):
            http_imports += bool(node.module and node.module.startswith("fastapi")) and any(
                name.name == "HTTPException" for name in node.names
            )
    for name, value in (
        ("router_db_calls", queries),
        ("commits", commits),
        ("broad_except", exceptions),
        ("service_http_exception", http_imports),
        ("type_ignore", len(re.findall(r"#\s*type:\s*ignore\b", source))),
        ("noqa", len(re.findall(r"#\s*noqa\b", source))),
        ("any_annotations", sum(isinstance(n, ast.Name) and n.id == "Any" for n in ast.walk(tree))),
    ):
        if value:
            counts[name] = int(value)
    return counts


def collect(root: Path) -> dict[str, dict[str, int]]:
    result = {}
    # git's source inventory excludes ignored caches, fonts, uploads and generated reports.
    output = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", *SOURCE_ROOTS],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout.decode()
    for relative in sorted(set(output.split("\0")) - {""}):
        path = root / relative
        if (
            not path.is_file()
            or path.name in GENERATED
            or path.suffix not in {".py", ".ts", ".tsx", ".css"}
        ):
            continue
        if ".test." in path.name or path.name.endswith(".d.ts") or "/test/" in relative:
            continue
        source = path.read_text(encoding="utf-8")
        counts = {}
        if path.suffix != ".css":
            excess = max(0, len(source.splitlines()) - 600)
            if excess:
                counts["lines_over_600"] = excess
        if path.suffix == ".py":
            counts.update(
                python_metrics(
                    source, router="/routers/" in relative, service="/services/" in relative
                )
            )
        elif path.suffix in {".ts", ".tsx"}:
            inline = len(re.findall(r"\bstyle\s*=\s*\{", source))
            if inline:
                counts["inline_styles"] = inline
        if counts:
            result[relative] = counts
    return result


def increases(current: dict, baseline: dict) -> list[str]:
    return [
        f"{path}: {metric} {baseline.get(path, {}).get(metric, 0)} -> {count}"
        for path, metrics in current.items()
        for metric, count in metrics.items()
        if count > baseline.get(path, {}).get(metric, 0)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--init", action="store_true", help="Create the first reviewed baseline only")
    mode.add_argument(
        "--ratchet", action="store_true", help="Save reductions; never accept increases"
    )
    args = parser.parse_args()
    current = collect(ROOT)
    if args.init and BASELINE.exists():
        parser.error("Baseline already exists; --init cannot overwrite it")
    if not args.init:
        if not BASELINE.is_file():
            parser.error("Missing reviewed debt baseline")
        errors = increases(current, json.loads(BASELINE.read_text())["files"])
        if errors:
            print("Technical debt increased:\n" + "\n".join(errors))
            return 1
    if args.init or args.ratchet:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps({"version": 1, "files": current}, indent=2, ensure_ascii=False) + "\n"
        )
    totals = {}
    for metrics in current.values():
        for key, value in metrics.items():
            totals[key] = totals.get(key, 0) + value
    print("Technical debt gate OK: " + json.dumps(totals, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
