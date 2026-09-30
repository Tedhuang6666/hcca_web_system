"""ffuf 路徑 fuzz 必須低頻、固定範圍、無認證且不保存本文。"""

import base64
import importlib.util
import json
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_fuzz", Path(__file__).resolve().parents[1] / "security-fuzz.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class FakeResponse:
    def __init__(self, status, headers=None):
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *_args):
        raise AssertionError("health control must never read response bodies")


class FakeOpener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return next(self.responses)


class ActiveFuzzTests(unittest.TestCase):
    def setup_target(
        self, temp_dir, control_responses, *, statuses=None, partial_after=None, timeout_after=None
    ):
        root = Path(temp_dir)
        wordlist = root / "paths.txt"
        paths = [f"api/route-{index}" for index in range(24)]
        wordlist.write_text("\n".join(paths) + "\n", encoding="utf-8")
        binary = root / "ffuf"
        binary.write_text("test binary\n", encoding="utf-8")
        binary.chmod(0o755)
        opener = FakeOpener(control_responses)
        address = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("104.21.36.175", 443))
        calls = []
        chunks = []
        statuses = statuses or [404] * len(paths)

        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            if command[-1] == "-V":
                return subprocess.CompletedProcess(command, 0, "ffuf version: 2.3.0\n", "")
            chunk = Path(command[command.index("-w") + 1]).read_text().splitlines()
            start = sum(len(previous) for previous in chunks)
            chunks.append(chunk)
            lines = []
            for position, path in enumerate(chunk, start=1):
                if len(chunks) == 1 and partial_after is not None and position > partial_after:
                    break
                if len(chunks) == 1 and timeout_after is not None and position > timeout_after:
                    break
                value = statuses[start + position - 1]
                record = {
                    "position": position,
                    "input": {"FUZZ": base64.b64encode(path.encode()).decode()},
                    "status": value,
                    "length": 12,
                    "content-type": "application/json",
                    "url": f"https://{scanner.HOST}/{path}",
                }
                lines.append(json.dumps(record))
            if len(chunks) == 1 and timeout_after is not None:
                raise subprocess.TimeoutExpired(
                    command,
                    kwargs["timeout"],
                    output="\n".join(lines) + "\n",
                )
            return subprocess.CompletedProcess(
                command,
                1 if len(chunks) == 1 and partial_after is not None else 0,
                "\n".join(lines) + "\n",
                "",
            )

        patches = (
            mock.patch.object(scanner.socket, "getaddrinfo", return_value=[address]),
            mock.patch.object(scanner.urllib.request, "build_opener", return_value=opener),
        )
        return wordlist, binary, opener, calls, chunks, fake_run, patches

    def run_scan(self, control_responses, *, statuses=None, partial_after=None, timeout_after=None):
        with tempfile.TemporaryDirectory() as temp_dir:
            wordlist, binary, opener, calls, chunks, fake_run, patches = self.setup_target(
                temp_dir,
                control_responses,
                statuses=statuses,
                partial_after=partial_after,
                timeout_after=timeout_after,
            )
            with patches[0], patches[1], mock.patch.object(scanner.time, "sleep") as sleeper:
                report = scanner.scan(
                    wordlist=wordlist,
                    ffuf_binary=binary,
                    runner=fake_run,
                    sleeper=sleeper,
                )
        return report, opener, calls, chunks, sleeper

    def test_fixed_scope_batches_rate_and_private_report_fields(self):
        report, opener, calls, chunks, sleeper = self.run_scan(
            [FakeResponse(200) for _ in range(4)]
        )

        self.assertEqual(len(scanner.load_paths()), 24)
        self.assertEqual(len(set(scanner.load_paths())), 24)
        self.assertEqual(report["result"], "complete")
        self.assertEqual(len(report["checks"]), 24)
        self.assertEqual(len(report["controls"]), 4)
        self.assertEqual(len(calls), 5)
        self.assertEqual(len(sleeper.call_args_list), 3)
        self.assertTrue(all(abs(call.args[0] - 310) < 1 for call in sleeper.call_args_list))
        for index, (command, kwargs) in enumerate(calls[1:]):
            self.assertEqual(command[command.index("-u") + 1], "https://hcca.tw/FUZZ")
            self.assertEqual(command[command.index("-X") + 1], "HEAD")
            self.assertEqual(command[command.index("-t") + 1], "1")
            self.assertEqual(command[command.index("-p") + 1], "45")
            self.assertIn("-ignore-body", command)
            self.assertIn("-sa", command)
            self.assertIn("-mc", command)
            self.assertEqual(command[command.index("-config") + 1], "/dev/null")
            self.assertNotIn("-r", command)
            self.assertNotIn("-b", command)
            self.assertNotIn("-H", command)
            self.assertEqual(kwargs["timeout"], scanner.BATCH_TIMEOUT_SECONDS + 5)
            self.assertLessEqual(len(chunks[index]), scanner.BATCH_SIZE)
        for request, timeout in opener.requests:
            self.assertEqual(request.get_method(), "HEAD")
            self.assertEqual(request.full_url, "https://hcca.tw/robots.txt")
            self.assertNotIn("Authorization", request.headers)
            self.assertNotIn("Cookie", request.headers)
            self.assertEqual(timeout, scanner.REQUEST_TIMEOUT_SECONDS)
        self.assertNotIn("FFUFHASH", json.dumps(report))
        self.assertNotIn("response_body", json.dumps(report))

    def test_rate_limit_stops_after_current_small_batch(self):
        statuses = [404, 404, 429, 404, 404, 404] + [404] * 18
        report, opener, calls, _chunks, sleeper = self.run_scan([], statuses=statuses)

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(len(report["checks"]), scanner.BATCH_SIZE)
        self.assertEqual(report["checks"][2]["outcome"], "incomplete")
        self.assertEqual(len(calls), 2)
        self.assertEqual(opener.requests, [])
        sleeper.assert_not_called()

    def test_partial_ffuf_output_is_preserved_and_does_not_continue(self):
        report, opener, calls, chunks, sleeper = self.run_scan([], partial_after=3)

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(
            [check["path"].lstrip("/") for check in report["checks"][:3]], chunks[0][:3]
        )
        self.assertEqual(report["checks"][-1]["error"], "IncompleteResults")
        self.assertEqual(len(calls), 2)
        self.assertEqual(opener.requests, [])
        sleeper.assert_not_called()

    def test_timeout_keeps_partial_ffuf_results(self):
        report, opener, calls, chunks, sleeper = self.run_scan([], timeout_after=3)

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(
            [check["path"].lstrip("/") for check in report["checks"][:3]], chunks[0][:3]
        )
        self.assertEqual(report["checks"][-1]["error"], "TimeoutExpired")
        self.assertEqual(len(calls), 2)
        self.assertEqual(opener.requests, [])
        sleeper.assert_not_called()

    def test_cloudflare_challenge_control_stops_before_next_batch(self):
        challenge = FakeResponse(200, {"cf-mitigated": "challenge"})
        report, opener, calls, _chunks, sleeper = self.run_scan([challenge])

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(len(report["checks"]), scanner.BATCH_SIZE)
        self.assertEqual(report["controls"][0]["outcome"], "incomplete")
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(opener.requests), 1)
        sleeper.assert_not_called()

    def test_non_public_resolution_and_missing_binary_fail_closed(self):
        runner = mock.Mock()
        address = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
        with mock.patch.object(scanner.socket, "getaddrinfo", return_value=[address]):
            report = scanner.scan(runner=runner)
        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(report["checks"], [])
        runner.assert_not_called()

        missing = Path("/tmp/hcca-ffuf-missing")
        report = scanner.scan(ffuf_binary=missing, runner=runner)
        self.assertEqual(report["error"], "FfufUnavailable")


if __name__ == "__main__":
    unittest.main()
