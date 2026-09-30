"""主動 DNS 發現固定於已核准網域，並且不連線至解析出的主機。"""

import importlib.util
import socket
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_dns", Path(__file__).resolve().parents[1] / "security-dns.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def address_row(address):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))


class ActiveDnsTests(unittest.TestCase):
    def run_scan(self, resolver):
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", side_effect=resolver),
            mock.patch.object(scanner.time, "sleep"),
        ):
            return scanner.scan()

    def test_scope_and_rate_are_fixed(self):
        self.assertEqual(scanner.HOST, "hcca.tw")
        self.assertEqual(len(scanner.LABELS), 13)
        self.assertIn("posthug", scanner.LABELS)
        self.assertEqual(scanner.INTERVAL_SECONDS, 1)
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
