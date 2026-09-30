"""真實 loopback HTTP 驗證範圍、停止條件與報告去識別化。"""

import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "security_baseline", Path(__file__).resolve().parents[1] / "security-baseline.py"
)
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.statuses = {}
        self.visited = []
        case = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                case.visited.append(self.path)
                kind = dict(baseline.PROBES).get(self.path, "disabled")
                status = case.statuses.get(
                    self.path, {"public": 200, "private": 401, "disabled": 404}[kind]
                )
                self.send_response(status)
                self.send_header(
                    "Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'"
                )
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "same-origin")
                self.send_header("Set-Cookie", "session=DO-NOT-STORE")
                self.send_header("Location", "/outside?token=DO-NOT-STORE")
                self.end_headers()
                self.wfile.write(b"DO-NOT-STORE")

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.target = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_default_public_request_interval_stays_below_waf_threshold(self):
        self.assertEqual(baseline.DEFAULT_INTERVAL_SECONDS, 45)
        self.assertEqual(baseline.MIN_PUBLIC_INTERVAL_SECONDS, 45)

    def test_expected_protection_and_no_response_data_in_report(self):
        report = baseline.scan(self.target, interval=0)
        self.assertEqual(report["result"], "pass")
        self.assertEqual(len(self.visited), len(baseline.PROBES))
        self.assertNotIn("DO-NOT-STORE", json.dumps(report))

    def test_redirect_is_incomplete_and_never_followed(self):
        self.statuses["/"] = 302
        report = baseline.scan(self.target, interval=0)
        self.assertEqual(report["result"], "incomplete")
        self.assertNotIn("/outside?token=DO-NOT-STORE", self.visited)

    def test_rate_limit_server_error_and_forbidden_stop_scan(self):
        for status in (429, 503, 403):
            with self.subTest(status=status):
                self.visited.clear()
                self.statuses["/"] = status
                report = baseline.scan(self.target, interval=0)
                self.assertEqual(report["result"], "incomplete")
                self.assertEqual(self.visited, ["/"])

    def test_private_success_is_a_finding(self):
        private_paths = [path for path, kind in baseline.PROBES if kind == "private"]
        self.assertGreaterEqual(len(private_paths), 1)
        for path in private_paths:
            with self.subTest(path=path):
                self.visited.clear()
                self.statuses.clear()
                self.statuses[path] = 200
                report = baseline.scan(self.target, interval=0)
                self.assertEqual(report["result"], "findings")

    def test_outside_scope_rejected_before_network(self):
        for target in (
            "https://example.com",
            "https://hcca.tw.evil.test",
            "https://test.hcca.tw",
            "https://user:secret@hcca.tw",
            "https://hcca.tw/?token=secret",
            "http://hcca.tw",
            "https://hcca.tw:8443",
            "https://hcca.tw/api",
            "https://hcca.tw/#fragment",
        ):
            with self.subTest(target=target), self.assertRaises(ValueError):
                baseline.scan(target, interval=0)
        self.assertEqual(self.visited, [])


if __name__ == "__main__":
    unittest.main()
