"""排程逐項執行探針、隔離 secrets，且不保存子程序輸出。"""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_schedule", Path(__file__).resolve().parents[1] / "security-schedule.py"
)
schedule = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schedule)


class SecurityScheduleTests(unittest.TestCase):
    def test_daily_mode_runs_all_three_independent_scans_after_failure(self):
        calls = []

        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            Path(command[command.index("--output") + 1]).write_text('{"result": "pass"}\n')
            code = 2 if len(calls) == 2 else 0
            return subprocess.CompletedProcess(command, code, "PRIVATE BODY", "PRIVATE COOKIE")

        with tempfile.TemporaryDirectory() as temp_dir:
            report_dir = Path(temp_dir) / "reports"
            summary, exit_code = schedule.run_mode(
                "daily",
                report_dir=report_dir,
                runner=fake_run,
                started_at=datetime(2026, 9, 30, 21, 41, tzinfo=UTC),
            )

            self.assertEqual(exit_code, 1)
            self.assertEqual(
                [item["name"] for item in summary["scans"]],
                ["dns", "active-inputs", "nuclei-auth"],
            )
            self.assertEqual(len(calls), 3)
            self.assertEqual(summary["scans"][1]["result"], "review")
            self.assertNotIn("PRIVATE", json.dumps(summary))
            directory_mode = report_dir.stat().st_mode
            self.assertFalse(directory_mode & 0o077)
            report_mode = report_dir.joinpath(summary["scans"][0]["report"]).stat().st_mode
            self.assertFalse(report_mode & 0o077)
            summary_mode = (
                report_dir.joinpath("20260930T214100.000000Z-summary.json").stat().st_mode
            )
            self.assertFalse(summary_mode & 0o077)

    def test_scanner_environment_does_not_inherit_application_secrets(self):
        with mock.patch.dict(
            "os.environ", {"SECRET_KEY": "do-not-copy", "TEST_DATABASE_URL": "db"}
        ):
            environment = schedule.scanner_environment()

        self.assertNotIn("SECRET_KEY", environment)
        self.assertNotIn("TEST_DATABASE_URL", environment)
        self.assertNotIn("HTTP_PROXY", environment)
        self.assertEqual(environment["TZ"], "Asia/Taipei")

    def test_weekly_scans_use_45_second_intervals(self):
        for mode, scanner_name in (
            ("http-baseline", "security-baseline.py"),
            ("path-enumeration", "security-paths.py"),
        ):
            with self.subTest(mode=mode):
                options = schedule.SCANS[mode][0]
                self.assertEqual(options[1], scanner_name)
                self.assertEqual(options[2], ("--interval", "45"))

    def test_zero_exit_without_valid_report_is_review(self):
        def fake_run(command, **_kwargs):
            return subprocess.CompletedProcess(command, 0)

        with tempfile.TemporaryDirectory() as temp_dir:
            summary, exit_code = schedule.run_mode(
                "http-baseline", report_dir=Path(temp_dir), runner=fake_run
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(summary["scans"][0]["error"], "MissingReport")
        self.assertEqual(summary["result"], "review")

    def test_unknown_mode_fails_before_writing_or_running(self):
        runner = mock.Mock()
        with tempfile.TemporaryDirectory() as temp_dir, self.assertRaises(ValueError):
            schedule.run_mode("outside-scope", report_dir=Path(temp_dir), runner=runner)
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
