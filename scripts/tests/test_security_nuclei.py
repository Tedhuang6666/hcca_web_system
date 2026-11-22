"""工具故障、空報告與不完整請求不可被解讀為沒有漏洞。"""

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "security_nuclei", Path(__file__).resolve().parents[1] / "security-nuclei.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class NucleiTests(unittest.TestCase):
    def simulate(self, *, urls=None, error="none", finding=False, exit_code=0):
        urls = scanner.EXPECTED if urls is None else urls

        def fake_run(command, **kwargs):
            trace = Path(command[command.index("-tlog") + 1])
            trace.write_text("\n".join(json.dumps({"input": url, "error": error}) for url in urls))
            output = Path(command[command.index("-jle") + 1])
            output.write_text(
                json.dumps(
                    {
                        "template-id": "hcca-public-auth-boundary",
                        "matched-at": sorted(scanner.EXPECTED)[0],
                        "response": "PRIVATE BODY",
                        "request": "PRIVATE COOKIE",
                    }
                )
                if finding
                else ""
            )
            return subprocess.CompletedProcess(command, exit_code)

        with patch.object(scanner.subprocess, "run", side_effect=fake_run):
            return scanner.run_scan()

    def test_two_completed_requests_without_findings(self):
        self.assertEqual(self.simulate()["result"], "pass")

    def test_empty_partial_network_error_and_exit_failure_are_incomplete(self):
        for options in (
            {"urls": []},
            {"urls": [sorted(scanner.EXPECTED)[0]]},
            {"error": "timeout"},
            {"exit_code": 1},
        ):
            with self.subTest(options=options):
                self.assertEqual(self.simulate(**options)["result"], "incomplete")

    def test_findings_do_not_include_raw_request_response(self):
        report = self.simulate(finding=True)
        self.assertEqual(report["result"], "findings")
        self.assertNotIn("PRIVATE", json.dumps(report))

    def test_missing_binary_is_incomplete(self):
        with patch.object(scanner.subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual(scanner.run_scan()["result"], "incomplete")


if __name__ == "__main__":
    unittest.main()
