"""ZAP 範圍、執行完整性及敏感報告保護。"""

import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "security_zap", Path(__file__).resolve().parents[1] / "security-zap.py"
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class ZapTests(unittest.TestCase):
    def test_zap_plan_runs_only_explicit_active_rules(self):
        plan = json.loads((scanner.ROOT / "security/zap-local.json").read_text())
        jobs = plan["jobs"]
        self.assertEqual(jobs[0]["type"], "passiveScan-config")
        self.assertTrue(jobs[0]["parameters"]["disableAllRules"])
        self.assertNotIn("passiveScan-wait", {job["type"] for job in jobs})
        active = next(job for job in jobs if job["type"] == "activeScan")
        rules = {rule["id"] for rule in active["policyDefinition"]["rules"]}
        self.assertEqual(rules, {int(rule_id) for rule_id in scanner.RULES})

    def test_only_dedicated_loopback_test_dependencies(self):
        env = {
            "TEST_DATABASE_URL": "postgresql+asyncpg://user@127.0.0.1/app_test",
            "REDIS_URL": "redis://127.0.0.1:6379/5",
            "RESEND_API_KEY": "PRIVATE SECRET",
        }
        safe = scanner.test_environment(env, Path("/tmp/isolated"))
        self.assertNotIn("RESEND_API_KEY", safe)
        for key, bad in [
            ("TEST_DATABASE_URL", "postgresql+asyncpg://user@hcca.tw/app_test"),
            ("TEST_DATABASE_URL", "postgresql+asyncpg://user@127.0.0.1/production"),
            ("TEST_DATABASE_URL", "postgresql+asyncpg://user@127.0.0.1/app_test?host=hcca.tw"),
            ("REDIS_URL", "redis://hcca.tw/5"),
        ]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                scanner.test_environment({**env, key: bad}, Path("/tmp/isolated"))

    def test_missing_rule_zero_requests_wrong_site_and_errors_are_incomplete(self):
        base = "http://127.0.0.1:8765"
        raw = {"site": [{"@name": base, "alerts": []}]}
        log = (
            "\n".join(
                f"completed host/plugin {base} | {name} in 1s "
                "with 10 message(s) sent and 0 alert(s) raised"
                for name in scanner.RULES.values()
            )
            + "\nJob report finished\nJob exitStatus finished"
        )
        self.assertEqual(scanner.summarize(raw, log, 0, base)["result"], "pass")
        for report, evidence, code in [
            (raw, log.replace("SqlInjectionScanRule", "Missing"), 0),
            (raw, log.replace("10 message", "0 message"), 0),
            ({"site": []}, log, 0),
            ({"site": [{"@name": "https://hcca.tw"}]}, log, 0),
            (raw, log + "\nAutomation plan errors:", 1),
            (raw, log, 3),
        ]:
            self.assertEqual(
                scanner.summarize(report, evidence, code, base)["result"], "incomplete"
            )
        raw["site"][0]["alerts"] = [
            {
                "pluginid": "40018",
                "riskcode": "3",
                "instances": [{"requestHeader": "PRIVATE COOKIE", "responseBody": "PRIVATE DATA"}],
            }
        ]
        report = scanner.summarize(raw, log, 1, base)
        self.assertEqual(report["result"], "findings")
        self.assertNotIn("PRIVATE", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
