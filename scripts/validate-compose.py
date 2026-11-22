"""Validate Compose entrypoints with disposable variables, without loading service env files."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "docker-compose.yml",
    "docker-compose.prod.yml",
    "docker-compose.prod.pull.yml",
    "docker-compose.bluegreen.yml",
    "docker-compose.bot.yml",
    "docker-compose.infrastructure.yml",
    "docker-compose.test.yml",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-binary", type=Path, help="Standalone Compose binary")
    args = parser.parse_args()
    command = [str(args.compose_binary.resolve())] if args.compose_binary else ["docker", "compose"]
    expected = json.loads((ROOT / "config/compose-images.json").read_text())
    sources = sorted(ROOT.glob("docker-compose*.yml"))
    required = {
        name
        for source in sources
        for name in re.findall(r"\$\{([A-Z_][A-Z_0-9]*):\?", source.read_text())
    }
    with tempfile.TemporaryDirectory(prefix="hcca-compose-") as directory:
        workspace = Path(directory)
        # Compose checks env_file existence even with --no-env-resolution. Copy only
        # public YAML sources; never use the checkout's local or production env files.
        for source in sources:
            shutil.copyfile(source, workspace / source.name)
        (workspace / ".env").write_text("")
        empty = workspace / "empty.env"
        empty.write_text("")
        environment = {"PATH": os.environ["PATH"], **{name: "validation" for name in required}}
        environment.update(
            PROD_ENV_FILE=str(empty),
            API_IMAGE="example.invalid/hcca-api:validation",
            WEB_IMAGE="example.invalid/hcca-web:validation",
            POSTGRES_USER="validation",
            POSTGRES_DB="validation_test",
            POSTGRES_PASSWORD="validation-only",
            REDIS_PASSWORD="validation-only",
            DOMAIN="example.invalid",
        )
        for file in FILES:
            result = subprocess.run(
                [
                    *command,
                    "--env-file",
                    str(empty),
                    "--profile",
                    "*",
                    "-f",
                    file,
                    "config",
                    "--no-env-resolution",
                    "--format",
                    "json",
                ],
                cwd=workspace,
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )
            config = json.loads(result.stdout)
            for name, service in config["services"].items():
                image = service.get("image")
                if not image or image.startswith("example.invalid/hcca-"):
                    continue
                base = image.rsplit(":", 1)[0]
                if expected.get(base) != image:
                    raise RuntimeError(
                        f"{file}:{name}: image differs from config/compose-images.json"
                    )
            print(f"OK {file}: config and image versions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
