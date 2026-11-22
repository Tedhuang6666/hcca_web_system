"""Compose validation must work in a fresh checkout without reading local secrets."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "compose_validation", Path(__file__).parents[1] / "validate-compose.py"
)
compose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compose)


class ComposeValidationTests(unittest.TestCase):
    def test_renders_exact_sources_in_disposable_workspace_without_local_env(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = "services:\n  app:\n    env_file: .env\n"
            (root / "docker-compose.yml").write_text(source)
            (root / ".env").write_text("LOCAL_SECRET=must-not-be-read\n")
            (root / "config").mkdir()
            (root / "config/compose-images.json").write_text("{}")

            def render(_command, *, cwd, env, **_kwargs):
                self.assertNotEqual(cwd, root)
                self.assertEqual((cwd / ".env").read_text(), "")
                self.assertEqual((cwd / "docker-compose.yml").read_text(), source)
                self.assertNotIn("LOCAL_SECRET", env)
                self.assertNotIn("SENTRY_AUTH_TOKEN", env)
                return type("Result", (), {"stdout": json.dumps({"services": {}})})()

            with (
                patch.object(compose, "ROOT", root),
                patch.object(compose, "FILES", ("docker-compose.yml",)),
                patch.object(compose.subprocess, "run", side_effect=render) as run,
                patch.dict(compose.os.environ, {"SENTRY_AUTH_TOKEN": "local-test-sentinel"}),
                patch("sys.argv", ["validate-compose.py"]),
            ):
                self.assertEqual(compose.main(), 0)
                self.assertEqual(run.call_count, 1)

    def test_supplies_required_placeholders_from_extended_fragments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docker-compose.yml").write_text("services: {}\n")
            fragment = "services:\n  runtime:\n    image: ${FRAGMENT_IMAGE:?set image}\n"
            (root / "docker-compose.runtime.yml").write_text(fragment)
            (root / "config").mkdir()
            (root / "config/compose-images.json").write_text("{}")

            def render(_command, *, cwd, env, **_kwargs):
                self.assertEqual(env.get("FRAGMENT_IMAGE"), "validation")
                self.assertEqual((cwd / "docker-compose.runtime.yml").read_text(), fragment)
                return type("Result", (), {"stdout": json.dumps({"services": {}})})()

            with (
                patch.object(compose, "ROOT", root),
                patch.object(compose, "FILES", ("docker-compose.yml",)),
                patch.object(compose.subprocess, "run", side_effect=render),
                patch("sys.argv", ["validate-compose.py"]),
            ):
                self.assertEqual(compose.main(), 0)


if __name__ == "__main__":
    unittest.main()
