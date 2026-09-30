"""公開 metadata 探針只索引核准網域，限速且不追蹤外站。"""

import importlib.util
import json
import socket
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_metadata", Path(__file__).resolve().parents[1] / "security-metadata.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self.body[:size]


class FakeOpener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return next(self.responses)


class ActiveMetadataTests(unittest.TestCase):
    def run_scan(self, responses):
        opener = FakeOpener(responses)
        row = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("104.21.36.175", 443))
        sleep = mock.Mock()
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", return_value=[row]),
            mock.patch.object(scanner.urllib.request, "build_opener", return_value=opener),
            mock.patch.object(scanner.time, "sleep", sleep),
        ):
            report = scanner.scan()
        return report, opener, sleep

    def test_scope_and_rate_are_fixed(self):
        self.assertEqual(scanner.HOST, "hcca.tw")
        self.assertEqual(scanner.PATHS, ("/robots.txt", "/sitemap.xml"))
        self.assertEqual(scanner.INTERVAL_SECONDS, 45)
        self.assertEqual(scanner.BODY_LIMIT, 524_288)

    def test_indexes_same_site_paths_and_discards_external_urls(self):
        robots = b"User-agent: *\nDisallow: /finance/\nSitemap: https://evil.example/map.xml\n"
        sitemap = (
            b"<urlset><url><loc>https://hcca.tw/regulations/one?token=x</loc></url>"
            b"<url><loc>https://evil.example/private</loc></url></urlset>"
        )
        report, opener, sleep = self.run_scan(
            [FakeResponse(200, robots), FakeResponse(200, sitemap)]
        )

        self.assertEqual(report["result"], "complete")
        self.assertEqual(len(opener.requests), 2)
        self.assertEqual(
            [row[0].full_url for row in opener.requests],
            [
                "https://hcca.tw/robots.txt",
                "https://hcca.tw/sitemap.xml",
            ],
        )
        self.assertEqual(sleep.call_args_list, [mock.call(scanner.INTERVAL_SECONDS)])
        encoded = json.dumps(report)
        self.assertIn("/regulations/one", encoded)
        self.assertNotIn("token=x", encoded)
        self.assertNotIn("https://evil.example/private", encoded)
        self.assertIn("evil.example", encoded)
        self.assertTrue(all("Cookie" not in request.headers for request, _ in opener.requests))

    def test_waf_response_stops_before_second_request(self):
        report, opener, sleep = self.run_scan([FakeResponse(429)])

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(len(opener.requests), 1)
        sleep.assert_not_called()

        report, opener, sleep = self.run_scan(
            [FakeResponse(200, b"challenge", {"cf-mitigated": "challenge"})]
        )

        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(report["checks"][0]["status"], 200)
        self.assertEqual(len(opener.requests), 1)
        sleep.assert_not_called()

    def test_rejects_unsafe_xml_and_oversized_responses(self):
        with self.assertRaisesRegex(ValueError, "UnsafeXmlDeclaration"):
            scanner.parse_sitemap(b"<!DOCTYPE x [<!ENTITY a 'b'>]><urlset/>")

        report, _, _ = self.run_scan(
            [FakeResponse(200, b""), FakeResponse(200, b"x" * (scanner.BODY_LIMIT + 1))]
        )
        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(report["checks"][-1]["error"], "ResponseTooLarge")

    def test_redirect_handler_never_follows(self):
        self.assertIsNone(
            scanner.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example")
        )


if __name__ == "__main__":
    unittest.main()
