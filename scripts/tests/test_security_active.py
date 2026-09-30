"""確保主動探針固定在核准範圍並限制回應內容保留。"""

import importlib.util
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "security_active", Path(__file__).resolve().parents[1] / "security-active.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class ActiveProbeTests(unittest.TestCase):
    def test_host_path_verb_and_request_ceiling_are_fixed(self):
        self.assertEqual(scanner.HOST, "hcca.tw")
        self.assertEqual(scanner.PATH, "/api/regulations/search")
        self.assertEqual(scanner.INTERVAL_SECONDS, 10)
        self.assertEqual(scanner.BODY_LIMIT, 262_144)

    def test_only_public_addresses_are_allowed(self):
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", return_value=[]),
            self.assertRaises(ValueError),
        ):
            scanner.resolve_target()
        row = (None, None, None, None, ("127.0.0.1", 443))
        with (
            mock.patch.object(scanner.socket, "getaddrinfo", return_value=[row]),
            self.assertRaises(ValueError),
        ):
            scanner.resolve_target()

    def test_statuses_do_not_claim_the_source_of_input_rejection(self):
        self.assertEqual(scanner.classify(200, "application/json", False, False), "pass")
        self.assertEqual(scanner.classify(400, "application/json", False, False), "rejected")
        self.assertEqual(scanner.classify(403, "application/json", False, False), "incomplete")
        self.assertEqual(scanner.classify(429, "application/json", False, False), "incomplete")
        self.assertEqual(scanner.classify(500, "application/json", False, False), "incomplete")
        self.assertEqual(scanner.classify(200, "application/json", True, False), "finding")


if __name__ == "__main__":
    unittest.main()
