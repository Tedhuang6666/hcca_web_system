from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class DeploySchedulerTests(unittest.TestCase):
    def run_deploy(self, workers: str) -> tuple[subprocess.CompletedProcess, list[list[str]]]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "bin").mkdir()
            shutil.copyfile(
                Path(__file__).parents[1] / "prod-pull-deploy.sh",
                root / "scripts/prod-pull-deploy.sh",
            )
            (root / "test.env").write_text(
                "SECRET_KEY=test-only\nPOSTGRES_PASSWORD=test-only\nREDIS_PASSWORD=test-only\n"
                "BACKUP_GPG_PASSPHRASE=test-only\nTRUST_CLOUDFLARE_PROXY=true\n"
                "CF_TRUSTED_PROXIES=172.20.0.0/16\n"
            )
            for name in ("wait-ghcr-image.sh", "zero-downtime-deploy.sh"):
                stub = root / "scripts" / name
                stub.write_text("#!/bin/sh\nexit 0\n")
                stub.chmod(0o755)
            docker = root / "bin/docker"
            docker.write_text(
                "#!/usr/bin/env python3\nimport json,os,sys\n"
                "with open(os.environ['DOCKER_LOG'],'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n"
                "if 'exec' in sys.argv: print('-- test backup')\n"
            )
            docker.chmod(0o755)
            log = root / "docker.jsonl"
            result = subprocess.run(
                ["bash", str(root / "scripts/prod-pull-deploy.sh")],
                cwd=root,
                env={
                    **os.environ,
                    "PATH": f"{root / 'bin'}:{os.environ['PATH']}",
                    "ENV_FILE": "test.env",
                    "SKIP_GIT": "1",
                    "RELEASE_SHA": "a" * 40,
                    "WITH_WORKERS": workers,
                    "DEPLOY_STRATEGY": "bluegreen",
                    "DOCKER_LOG": str(log),
                },
                capture_output=True,
                text=True,
            )
            return result, [json.loads(line) for line in log.read_text().splitlines()]

    def test_bluegreen_cleanup_preserves_shared_scheduler_and_dependencies(self) -> None:
        result, commands = self.run_deploy("1")
        self.assertEqual(result.returncode, 0, result.stderr)
        stopped = [cmd[cmd.index("stop") + 1 :] for cmd in commands if "stop" in cmd]
        self.assertEqual(stopped, [["api", "web", "celery-worker"]])
        email_update = next(cmd for cmd in commands if cmd[-1] == "email-worker")
        self.assertIn("--no-deps", email_update)

    def test_disabling_workers_still_stops_old_scheduler(self) -> None:
        result, commands = self.run_deploy("0")
        self.assertEqual(result.returncode, 0, result.stderr)
        stopped = [cmd[cmd.index("stop") + 1 :] for cmd in commands if "stop" in cmd]
        self.assertEqual(stopped, [["api", "web", "celery-worker", "celery-beat"]])


if __name__ == "__main__":
    unittest.main()
