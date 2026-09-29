"""Check maintained agent entrypoints without importing the app or loading secrets."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = (
    "AGENTS.md",
    "CLAUDE.md",
    "PROJECT_CONTEXT.md",
    "apps/api/AGENTS.md",
    "apps/web/AGENTS.md",
    "README.md",
    "apps/api/README.md",
    "apps/web/README.md",
    "docs/README.md",
    "docs/AI_WORKFLOW.md",
    "docs/HANDOFF_CHECKLIST.md",
    "docs/LOCAL_TOOLING.md",
    "docs/tooling-optimization.md",
    ".agents/skills/hcca-maintenance/SKILL.md",
)


def broken_links(root: Path, relative: str) -> list[str]:
    document = root / relative
    if not document.is_file():
        return [f"Missing document: {relative}"]
    source = document.read_text(encoding="utf-8")
    source = re.sub(r"```.*?```", "", source, flags=re.DOTALL)
    errors = []
    for link in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", source):
        target = urlsplit(link.strip("<>"))
        if target.scheme or target.netloc or not target.path:
            continue
        path = (document.parent / unquote(target.path)).resolve()
        if not path.is_relative_to(root.resolve()) or not path.exists():
            errors.append(f"Broken/local-only link: {relative} -> {link}")
    return errors


def validate_test_database(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        database = unquote(parsed.path.removeprefix("/"))
        valid = (
            parsed.scheme == "postgresql+asyncpg"
            and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and database.endswith("_test")
            and "/" not in database
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        valid = False
    if valid:
        return None
    return "TEST_DATABASE_URL must use postgresql+asyncpg, a loopback host and a *_test database (no query)."


def check_documents(root: Path) -> list[str]:
    errors = [error for path in DOCUMENTS for error in broken_links(root, path)]
    for relative in (".codex/config.toml", "pyproject.toml", "apps/api/pyproject.toml"):
        try:
            tomllib.loads((root / relative).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            errors.append(f"Invalid TOML: {relative} ({type(error).__name__})")
    try:
        package = json.loads((root / "apps/web/package.json").read_text(encoding="utf-8"))
        for script in (
            "lint",
            "type-check",
            "test",
            "build",
            "check:module-registry",
            "generate:types",
        ):
            if script not in package.get("scripts", {}):
                errors.append(f"Missing web script: {script}")
    except (OSError, ValueError) as error:
        errors.append(f"Invalid web package.json ({type(error).__name__})")
    # git ls-files also sees staged additions, unlike checking HEAD before first commit.
    tracked = (
        subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True)
        .stdout.decode()
        .split("\0")
    )
    for relative in (*DOCUMENTS, ".codex/config.toml", "scripts/check.sh", ".gitnexusignore"):
        if relative not in tracked:
            errors.append(f"Maintenance entrypoint is not versioned/staged: {relative}")
    return errors


def doctor(root: Path) -> int:
    failures = 0
    for name, args in (
        ("git", ["--version"]),
        ("python3", ["--version"]),
        ("uv", ["--version"]),
        ("node", ["--version"]),
        ("npm", ["--version"]),
        ("codex", ["--version"]),
        ("claude", ["--version"]),
        ("docker", ["compose", "version"]),
    ):
        if not shutil.which(name):
            print(f"MISSING {name}")
            failures += 1
            continue
        try:
            result = subprocess.run(
                [name, *args], cwd=root, capture_output=True, text=True, timeout=15
            )
            first_line = (result.stdout or result.stderr).strip().splitlines()
            print(
                f"{'OK' if result.returncode == 0 else 'FAIL'} {name}: {first_line[0] if first_line else 'no output'}"
            )
            failures += result.returncode != 0
        except (OSError, subprocess.TimeoutExpired):
            print(f"FAIL {name}: unavailable or timed out")
            failures += 1
    for relative in (".venv/bin/python", "apps/web/node_modules/.bin/tsc", ".gitnexus/run.cjs"):
        exists = (root / relative).exists()
        print(f"{'OK' if exists else 'MISSING'} {relative}")
        failures += not exists
    for name in ("pyright-langserver", "typescript-language-server"):
        print(f"{'OK' if shutil.which(name) else 'MISSING'} optional Claude LSP: {name}")
    metadata = root / ".gitnexus/meta.json"
    if metadata.exists():
        print(
            "INFO GitNexus: run node .gitnexus/run.cjs status to verify content and runner freshness."
        )
    print(
        "INFO No services started; database connectivity, plugin authentication and tests are not checked."
    )
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--doctor", action="store_true")
    mode.add_argument("--test-database", action="store_true")
    args = parser.parse_args()
    if args.doctor:
        return doctor(ROOT)
    if args.test_database:
        error = validate_test_database(os.environ.get("TEST_DATABASE_URL", ""))
        if error:
            print(error, file=sys.stderr)  # Never echo credentials from the URL.
            return 1
        print("Test database target accepted (local PostgreSQL *_test).")
        return 0
    errors = check_documents(ROOT)
    for error in errors:
        print(error, file=sys.stderr)
    if not errors:
        print(f"Agent setup OK: {len(DOCUMENTS)} documents, links, config and tracked entrypoints.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
