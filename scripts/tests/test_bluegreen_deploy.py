import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "zero-downtime-deploy.sh"


class BlueGreenDeployTests(unittest.TestCase):
    def deploy(self, current, *, skip_migrate="1", migration_mode="", fail_target=False):
        with tempfile.TemporaryDirectory() as directory:
            workdir = Path(directory)
            state_dir = workdir / ".deploy-state"
            state_dir.mkdir()
            (state_dir / "active-slot").write_text("blue\n")
            log = workdir / "docker.jsonl"
            docker = workdir / "docker"
            docker.write_text(
                """#!/usr/bin/env python3
import json
import os
import sys

command = sys.argv[1:]
with open(os.environ["TEST_DOCKER_LOG"], "a") as log:
    print(json.dumps([os.environ["API_IMAGE"], *command]), file=log)

if "ps" in command:
    print(command[-1] + "-container")
elif command[0] == "inspect":
    print("sha256:" + "a" * 64 if "{{.Image}}" in command else "healthy")
elif "current" in command:
    if os.environ["TEST_ALEMBIC_CURRENT"] == "fail":
        sys.exit(1)
    print(os.environ["TEST_ALEMBIC_CURRENT"])
elif "up" in command and "api-green" in command:
    sys.exit(int(os.environ["TEST_FAIL_TARGET"]))
"""
            )
            docker.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT), "green"],
                cwd=workdir,
                env={
                    **os.environ,
                    "PATH": f"{workdir}:{os.environ['PATH']}",
                    "TEST_DOCKER_LOG": str(log),
                    "TEST_ALEMBIC_CURRENT": current,
                    "TEST_FAIL_TARGET": str(int(fail_target)),
                    "API_IMAGE": "hcca-api:candidate",
                    "PETITION_PREVIEW_IMAGE": "hcca-preview:candidate",
                    "WEB_IMAGE": "hcca-web:candidate",
                    "WITH_WORKERS": "1",
                    "AUTO_ROLLBACK": "1",
                    "MAINTENANCE_MODE": "0" if skip_migrate == "1" else "1",
                    "DEPLOY_MIGRATION_MODE": migration_mode,
                    "SKIP_MIGRATE": skip_migrate,
                    "SKIP_SMOKE": "1",
                    "DRAIN_SECONDS": "0",
                },
                capture_output=True,
                text=True,
                timeout=10,
            )
            commands = [json.loads(line) for line in log.read_text().splitlines()]
            return result, commands, (state_dir / "active-slot").read_text().strip()

    def test_settings_failure_leaves_active_slot_untouched(self):
        result, commands, slot = self.deploy("fail", skip_migrate="0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Alembic current failed", result.stderr)
        self.assertEqual(slot, "blue")
        self.assertFalse(any("stop" in command or "proxy" in command for command in commands))

    def test_skip_migration_requires_target_head(self):
        result, commands, slot = self.deploy("20261117030000")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Database revision is behind", result.stderr)
        self.assertEqual(slot, "blue")
        self.assertFalse(any("up" in command and "api-green" in command for command in commands))

    def test_failed_target_reuses_previous_containers_and_scheduler_image(self):
        result, commands, slot = self.deploy("20261117040000 (head)", fail_target=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("已恢復舊 slot", result.stderr)
        self.assertEqual(slot, "blue")
        self.assertIn(
            ["hcca-api:candidate", "start", "api-blue-container", "web-blue-container"],
            commands,
        )
        scheduler = next(
            cmd for cmd in commands if "up" in cmd and "--pull" in cmd and cmd[-1] == "celery-beat"
        )
        self.assertEqual(scheduler[0], "sha256:" + "a" * 64)
        self.assertIn("--no-deps", scheduler)
        self.assertFalse(any("up" in command and "api-blue" in command for command in commands))
        self.assertEqual(sum("run" in command for command in commands), 1)

    def test_maintenance_runs_upgrade_once_before_target_start(self):
        result, commands, slot = self.deploy("20261117030000", migration_mode="auto")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(slot, "green")
        upgrade = next(cmd for cmd in commands if "run" in cmd and cmd[-1] == "migrate")
        target_starts = [cmd for cmd in commands if "up" in cmd and "api-green" in cmd]
        self.assertEqual(len(target_starts), 2)
        self.assertTrue(all("petition-preview-worker" in cmd for cmd in target_starts))
        pull = next(cmd for cmd in commands if "pull" in cmd)
        self.assertIn("petition-preview-worker", pull)
        preview_health_wait = next(
            index
            for index, cmd in enumerate(commands)
            if "ps" in cmd and cmd[-1] == "petition-preview-worker"
        )
        caddy_reload = max(
            index for index, cmd in enumerate(commands) if "exec" in cmd and "reload" in cmd
        )
        self.assertLess(preview_health_wait, caddy_reload)
        self.assertLess(commands.index(upgrade), commands.index(target_starts[0]))
        self.assertTrue(all("--no-deps" in cmd for cmd in target_starts))
        self.assertEqual(sum("run" in cmd and cmd[-1] == "migrate" for cmd in commands), 1)
        self.assertEqual(sum("up" in cmd and cmd[-1] == "proxy" for cmd in commands), 1)


if __name__ == "__main__":
    unittest.main()
