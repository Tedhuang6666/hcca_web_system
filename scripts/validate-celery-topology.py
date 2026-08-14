"""Fail CI when a Celery queue is declared but no compose worker consumes it."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CELERY_APP = ROOT / "apps/api/src/api/core/celery_app.py"
COMPOSE_FILES = sorted(ROOT.glob("docker-compose*.yml"))


def declared_queues() -> set[str]:
    source = CELERY_APP.read_text(encoding="utf-8")
    queues = set(re.findall(r'Queue\("([a-zA-Z0-9_-]+)"\)', source))
    queues.update(re.findall(r'"queue"\s*:\s*"([a-zA-Z0-9_-]+)"', source))
    return queues


def consumed_queues(compose_file: Path) -> set[str]:
    source = compose_file.read_text(encoding="utf-8")
    return {
        queue
        for value in re.findall(r"--queues=([a-zA-Z0-9_,-]+)", source)
        for queue in value.split(",")
        if queue
    }


def main() -> int:
    required = declared_queues()
    if not required:
        print("No Celery queues found in celery_app.py", file=sys.stderr)
        return 1

    failures: list[str] = []
    for compose_file in COMPOSE_FILES:
        source = compose_file.read_text(encoding="utf-8")
        if " celery" not in source or "worker" not in source:
            continue
        consumed = consumed_queues(compose_file)
        missing = sorted(required - consumed)
        if missing:
            failures.append(f"{compose_file.name}: missing consumers for {', '.join(missing)}")
        else:
            print(f"{compose_file.name}: all queues consumed ({', '.join(sorted(consumed))})")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
