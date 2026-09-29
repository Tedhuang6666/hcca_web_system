from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "agent_setup", Path(__file__).resolve().parents[1] / "check-agent-setup.py"
)
assert spec and spec.loader
agent_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_setup)


class AgentSetupTests(unittest.TestCase):
    def test_failed_export_preserves_last_good_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "bin").mkdir()
            script = Path(__file__).resolve().parents[1] / "update-openapi.sh"
            shutil.copyfile(script, root / "scripts/update-openapi.sh")
            (root / "openapi.json").write_text('{"last_good": true}')
            stub = root / "bin/uv"
            stub.write_text("#!/bin/sh\nexit 17\n")
            stub.chmod(0o755)
            result = subprocess.run(
                ["bash", str(root / "scripts/update-openapi.sh")],
                cwd=root / "bin",
                env={**os.environ, "PATH": f"{root / 'bin'}:{os.environ['PATH']}"},
                capture_output=True,
            )
            self.assertEqual(result.returncode, 17)
            self.assertEqual((root / "openapi.json").read_text(), '{"last_good": true}')

    def test_links_resolve_relative_to_document_and_ignore_examples(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "AGENTS.md").write_text("rules")
            (root / "docs/guide.md").write_text(
                "[rules](../AGENTS.md#rules) [external](https://example.com)\n"
                "```md\n[example](missing.md)\n```\n"
            )
            self.assertEqual(agent_setup.broken_links(root, "docs/guide.md"), [])

    def test_missing_and_outside_repository_links_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "guide.md").write_text("[missing](missing.md) [outside](../)")
            self.assertEqual(len(agent_setup.broken_links(root, "guide.md")), 2)
            self.assertTrue(agent_setup.broken_links(root, "absent.md"))

    def test_only_explicit_local_postgres_test_targets_are_accepted(self) -> None:
        for host in ("localhost", "127.0.0.1", "[::1]"):
            self.assertIsNone(
                agent_setup.validate_test_database(
                    f"postgresql+asyncpg://tester:password@{host}:5432/campus_platform_test"
                )
            )
        for url in (
            "",
            "sqlite+aiosqlite:///:memory:",
            "postgresql+asyncpg://localhost/campus_platform",
            "postgresql+asyncpg://production.invalid/campus_platform_test",
            "postgresql+asyncpg://localhost/campus_test?host=production.invalid",
            "postgresql+asyncpg://localhost/a%2fb_test",
            "postgresql+asyncpg://[bad/campus_test",
        ):
            with self.subTest(url=url):
                self.assertIsNotNone(agent_setup.validate_test_database(url))


if __name__ == "__main__":
    unittest.main()
