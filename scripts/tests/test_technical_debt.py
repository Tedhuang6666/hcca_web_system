import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "debt", Path(__file__).parents[1] / "check-technical-debt.py"
)
debt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(debt)


class DebtGateTests(unittest.TestCase):
    def test_distinguishes_database_calls_from_unrelated_methods(self):
        result = debt.python_metrics(
            "async def example(session, request):\n"
            "    await session.execute(query)\n"
            "    request.get('header')\n"
            "    await session.commit()\n",
            router=True,
            service=False,
        )
        self.assertEqual(result, {"router_db_calls": 1, "commits": 1})

    def test_new_files_cannot_reintroduce_removed_debt(self):
        self.assertEqual(debt.increases({"new.py": {"commits": 1}}, {}), ["new.py: commits 0 -> 1"])
        self.assertEqual(debt.increases({"old.py": {"commits": 1}}, {"old.py": {"commits": 2}}), [])

    def test_allows_small_frontend_debt_increases_but_rejects_excess(self):
        baseline = {"page.tsx": {"lines_over_600": 100, "inline_styles": 2}}
        self.assertEqual(
            debt.increases(
                {"page.tsx": {"lines_over_600": 150, "inline_styles": 7}},
                baseline,
            ),
            [],
        )
        self.assertEqual(
            debt.increases({"page.tsx": {"lines_over_600": 151}}, baseline),
            ["page.tsx: lines_over_600 100 -> 151"],
        )
        self.assertEqual(
            debt.increases({"page.tsx": {"inline_styles": 8}}, baseline),
            ["page.tsx: inline_styles 2 -> 8"],
        )

    def test_detects_catches_and_fastapi_leaks_but_allows_specific_errors(self):
        result = debt.python_metrics(
            "from fastapi import HTTPException\n"
            "try:\n    run()\nexcept ValueError:\n    raise\n"
            "try:\n    run()\nexcept Exception:\n    pass\n",
            router=False,
            service=True,
        )
        self.assertEqual(result, {"broad_except": 1, "service_http_exception": 1})
