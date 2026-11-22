"""主動路徑枚舉必須固定範圍、只送 HEAD 並遵守停止條件。"""

import importlib.util
import json
import socket
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_paths", Path(__file__).resolve().parents[1] / "security-paths.py"
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

    def read(self, *args):
        raise AssertionError("path probe must never read response bodies")


class FakeOpener:
    def __init__(self, statuses):
        self.statuses = iter(statuses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        return FakeResponse(next(self.statuses))


class ActivePathTests(unittest.TestCase):
    def run_scan(self, statuses, *, interval=scanner.INTERVAL_SECONDS, sleep=None):
        opener = FakeOpener(statuses)
        row = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))
        sleep = sleep or mock.Mock()
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", return_value=[row]),
            mock.patch.object(scanner.urllib.request, "build_opener", return_value=opener),
            mock.patch.object(scanner.time, "sleep", sleep),
        ):
            report = scanner.scan(interval=interval)
        return report, opener

    def test_scope_request_count_and_rate_are_fixed(self):
        self.assertEqual(scanner.HOST, "hcca.tw")
        self.assertEqual(len(scanner.PROBES), 12)
        self.assertEqual(scanner.INTERVAL_SECONDS, 45)
        self.assertEqual(scanner.TIMEOUT_SECONDS, 10)

    def test_head_probes_never_read_bodies_or_send_credentials(self):
        report, opener = self.run_scan([404] * len(scanner.PROBES))
        self.assertEqual(report["result"], "pass")
        self.assertEqual(len(opener.requests), len(scanner.PROBES))
        self.assertTrue(all(request.get_method() == "HEAD" for request in opener.requests))
        self.assertTrue(all(request.host == scanner.HOST for request in opener.requests))
        self.assertTrue(
            all(
                "Authorization" not in request.headers and "Cookie" not in request.headers
                for request in opener.requests
            )
        )
        self.assertNotIn("1.1.1.1", json.dumps(report))

    def test_configured_interval_is_applied_between_all_requests(self):
        sleep = mock.Mock()
        self.run_scan([404] * len(scanner.PROBES), interval=45, sleep=sleep)
        self.assertEqual(sleep.call_args_list, [mock.call(45)] * (len(scanner.PROBES) - 1))

    def test_sensitive_path_is_only_a_review_candidate(self):
        report, _ = self.run_scan([200, *([404] * (len(scanner.PROBES) - 1))])
        self.assertEqual(report["result"], "review")
        self.assertEqual(report["checks"][0]["outcome"], "review")
        self.assertNotEqual(report["result"], "findings")

    def test_redirect_handler_never_follows(self):
        self.assertIsNone(
            scanner.NoRedirect().redirect_request(None, None, 302, "", {}, "/outside")
        )

    def test_waf_challenge_and_server_errors_stop_enumeration(self):
        for status, headers in (
            (302, {}),
            (403, {}),
            (429, {}),
            (503, {}),
            (200, {"cf-mitigated": "challenge"}),
        ):
            with self.subTest(status=status, headers=headers):
                opener = FakeOpener([404, *([404] * 10)])
                row = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))
                with (
                    mock.patch.object(scanner.socket, "getaddrinfo", return_value=[row]),
                    mock.patch.object(scanner.urllib.request, "build_opener", return_value=opener),
                    mock.patch.object(scanner.time, "sleep"),
                ):
                    opener.open = mock.Mock(
                        side_effect=[FakeResponse(404), FakeResponse(status, headers)]
                    )
                    report = scanner.scan()
                self.assertEqual(report["result"], "incomplete")
                self.assertEqual(len(report["checks"]), 2)

    def test_non_public_dns_resolution_fails_closed(self):
        row = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
        with mock.patch.object(scanner.socket, "getaddrinfo", return_value=[row]):
            report = scanner.scan()
        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(report["checks"], [])


if __name__ == "__main__":
    unittest.main()
