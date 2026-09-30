"""主動 DNS 發現固定於已核准網域，並且不連線至解析出的主機。"""

import importlib.util
import io
import json
import socket
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location(
    "security_dns", Path(__file__).resolve().parents[1] / "security-dns.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def address_row(address):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))


class ActiveDnsTests(unittest.TestCase):
    def run_scan(self, resolver, cname_resolver=None):
        cname_resolver = cname_resolver or (lambda _hostname: {"status": "none"})
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", side_effect=resolver),
            mock.patch.object(scanner.time, "sleep"),
            mock.patch.object(scanner, "resolve_cname", side_effect=cname_resolver),
        ):
            return scanner.scan()

    def test_scope_and_rate_are_fixed(self):
        self.assertEqual(scanner.HOST, "hcca.tw")
        self.assertEqual(len(scanner.LABELS), 13)
        self.assertIn("posthug", scanner.LABELS)
        self.assertEqual(scanner.INTERVAL_SECONDS, 1)
        self.assertTrue(scanner.DNS_OVER_HTTPS_URL.startswith("https://"))
        self.assertTrue(
            any(isinstance(handler, scanner.NoRedirect) for handler in scanner.DNS_OPENER.handlers)
        )
        self.assertTrue(all("." not in label for label in scanner.LABELS))

    def test_resolved_names_are_candidates_only_and_wildcard_is_marked(self):
        def resolver(hostname, *_args, **_kwargs):
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            if hostname.startswith(scanner.CONTROL_PREFIX):
                return [address_row("104.21.36.175")]
            if hostname == f"api.{scanner.HOST}":
                return [address_row("104.21.36.175")]
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        report = self.run_scan(resolver)
        self.assertEqual(report["result"], "complete")
        self.assertEqual(report["wildcard_control"], "resolved")
        self.assertEqual(report["candidates"][0]["hostname"], "api.hcca.tw")
        self.assertEqual(report["candidates"][0]["status"], "wildcard-suspect")
        self.assertNotIn("http", report["method"].lower())

    def test_distinct_public_dns_result_is_not_scanned(self):
        def resolver(hostname, *_args, **_kwargs):
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            if hostname.startswith(scanner.CONTROL_PREFIX):
                raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
            if hostname == f"www.{scanner.HOST}":
                return [address_row("1.1.1.1")]
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        report = self.run_scan(resolver)
        self.assertEqual(report["result"], "complete")
        self.assertEqual(report["candidates"][0]["status"], "dns-resolves")
        self.assertEqual(report["candidates"][0]["addresses"], ["1.1.1.1"])

    def test_cname_target_is_recorded_without_connecting_to_vendor(self):
        def resolver(hostname, *_args, **_kwargs):
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            if hostname.startswith(scanner.CONTROL_PREFIX):
                raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
            if hostname == f"posthug.{scanner.HOST}":
                return [address_row("104.20.19.245")]
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        report = self.run_scan(
            resolver,
            cname_resolver=lambda hostname: (
                {
                    "status": "present",
                    "targets": ["vendor.example"],
                }
                if hostname == f"posthug.{scanner.HOST}"
                else {"status": "none"}
            ),
        )
        candidate = report["candidates"][0]
        self.assertEqual(candidate["hostname"], "posthug.hcca.tw")
        self.assertEqual(candidate["cname_targets"], ["vendor.example"])
        self.assertNotIn("http", report["method"].lower())

    def test_cname_lookup_uses_fixed_doh_resolver_without_redirects(self):
        payload = {"Status": 0, "Answer": [{"type": 5, "data": "vendor.example."}]}
        with mock.patch.object(
            scanner.DNS_OPENER,
            "open",
            return_value=io.BytesIO(json.dumps(payload).encode()),
        ) as open_request:
            result = scanner.resolve_cname("posthug.hcca.tw")

        request = open_request.call_args.args[0]
        parsed = urlsplit(request.full_url)
        self.assertEqual(parsed.hostname, "cloudflare-dns.com")
        self.assertEqual(parse_qs(parsed.query), {"name": ["posthug.hcca.tw"], "type": ["CNAME"]})
        self.assertEqual(request.get_header("Accept"), "application/dns-json")
        self.assertEqual(result, {"status": "present", "targets": ["vendor.example"]})

    def test_cname_query_failure_marks_dns_discovery_incomplete(self):
        def resolver(hostname, *_args, **_kwargs):
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            if hostname.startswith(scanner.CONTROL_PREFIX):
                raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
            if hostname == f"posthug.{scanner.HOST}":
                return [address_row("104.20.19.245")]
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        report = self.run_scan(
            resolver,
            cname_resolver=lambda _hostname: {"status": "incomplete", "error": "TimeoutError"},
        )
        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(report["candidates"][0]["cname_status"], "incomplete")

    def test_non_public_addresses_require_review_without_disclosing_ip(self):
        def resolver(hostname, *_args, **_kwargs):
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            if hostname.startswith(scanner.CONTROL_PREFIX):
                raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
            if hostname == f"admin.{scanner.HOST}":
                return [address_row("127.0.0.1")]
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        report = self.run_scan(resolver)
        self.assertEqual(report["result"], "review")
        self.assertEqual(report["candidates"][0]["status"], "non-public-address")
        self.assertNotIn("127.0.0.1", str(report))

    def test_transient_dns_error_is_incomplete(self):
        calls = 0

        def resolver(hostname, *_args, **_kwargs):
            nonlocal calls
            calls += 1
            if hostname == scanner.HOST:
                return [address_row("104.21.36.175")]
            raise socket.gaierror(socket.EAI_AGAIN, "Temporary failure")

        report = self.run_scan(resolver)
        self.assertEqual(report["result"], "incomplete")
        self.assertEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
