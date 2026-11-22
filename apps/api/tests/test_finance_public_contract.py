"""公開財務回應的欄位界線；可獨立於資料庫驗證。"""

import unittest
import uuid

from api.schemas.finance import PublicBudgetExpenseOut, PublicBudgetIncomeRecordOut


class PublicFinanceContractTests(unittest.TestCase):
    def test_income_keeps_item_identity_and_omits_internal_fields(self) -> None:
        item_id = uuid.uuid4()
        record = PublicBudgetIncomeRecordOut.model_validate(
            {
                "id": uuid.uuid4(),
                "income_item_id": item_id,
                "category": "活動",
                "name": "報名費",
                "amount": 400,
                "entry_date": "2026-11-01",
                "note": "內部備註",
                "recorded_by_id": uuid.uuid4(),
                "is_legacy": True,
            }
        ).model_dump(mode="json")
        self.assertEqual(record["income_item_id"], str(item_id))
        self.assertEqual(
            set(record), {"id", "income_item_id", "category", "name", "amount", "entry_date"}
        )

    def test_expense_omits_operator_and_other_private_fields(self) -> None:
        expense = PublicBudgetExpenseOut.model_validate(
            {
                "id": uuid.uuid4(),
                "entry_date": "2026-11-01",
                "created_at": "2026-11-01T01:00:00Z",
                "operator_name": "測試操作人",
                "recorded_by_id": uuid.uuid4(),
                "purpose": "活動用品",
                "allocation_node_id": uuid.uuid4(),
                "allocation_name": "用品費",
                "total_amount": 300,
                "items": [],
                "evidence": [],
                "note": "內部備註",
            }
        ).model_dump(mode="json")
        self.assertNotIn("operator_name", expense)
        self.assertNotIn("recorded_by_id", expense)
        self.assertNotIn("note", expense)
        self.assertEqual(expense["total_amount"], 300)
