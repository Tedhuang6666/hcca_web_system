"""目前核定預算：版本取代、追加、總表與歷史核銷的共同規則。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.finance import (
    BudgetSubmissionStatus,
    FinanceBudgetAllocation,
    FinanceBudgetIncomeItem,
    FinanceBudgetNode,
    FinanceBudgetSubmission,
)
from api.schemas.finance import BudgetPlanOut, BudgetPlanRowOut, BudgetVersionChangeOut


class ApprovedBudgetPlan:
    """以時間順序的申報紀錄決定目前總表，保留歷史核銷原本的配置。"""

    def __init__(self, submissions: Sequence[FinanceBudgetSubmission]) -> None:
        self._approved = [
            item for item in submissions if item.status == BudgetSubmissionStatus.APPROVED
        ]
        self.submission_ids = self._effective_ids(self._approved)

    @classmethod
    async def load(cls, db: AsyncSession, budget_id: uuid.UUID) -> ApprovedBudgetPlan:
        submissions = (
            await db.scalars(
                select(FinanceBudgetSubmission)
                .where(FinanceBudgetSubmission.budget_id == budget_id)
                .order_by(FinanceBudgetSubmission.created_at)
            )
        ).all()
        return cls(submissions)

    @staticmethod
    def _effective_ids(submissions: Sequence[FinanceBudgetSubmission]) -> set[uuid.UUID]:
        effective: set[uuid.UUID] = set()
        for submission in submissions:
            if submission.is_full_snapshot:
                effective.clear()
            effective.add(submission.id)
        return effective

    def permits_expense(
        self,
        allocation: FinanceBudgetAllocation,
        *,
        original_allocation_id: uuid.UUID | None = None,
    ) -> bool:
        if allocation.submission_id in self.submission_ids:
            return True
        return allocation.id == original_allocation_id and any(
            item.id == allocation.submission_id for item in self._approved
        )

    def allocated_amounts(
        self, allocations: Sequence[FinanceBudgetAllocation]
    ) -> dict[uuid.UUID, int]:
        totals: dict[uuid.UUID, int] = {}
        for allocation in allocations:
            if allocation.submission_id in self.submission_ids:
                totals[allocation.node_id] = totals.get(allocation.node_id, 0) + allocation.amount
        return totals

    @staticmethod
    def _rows(
        submission_ids: set[uuid.UUID],
        allocations: Sequence[FinanceBudgetAllocation],
        nodes: Sequence[FinanceBudgetNode],
        income_items: Sequence[FinanceBudgetIncomeItem],
    ) -> list[BudgetPlanRowOut]:
        node_by_id = {node.id: node for node in nodes}
        rows = []
        for allocation in allocations:
            if allocation.submission_id not in submission_ids:
                continue
            node = node_by_id.get(allocation.node_id)
            parent = node_by_id.get(node.parent_id) if node and node.parent_id else None
            rows.append(
                BudgetPlanRowOut(
                    id=allocation.id,
                    category=parent.name if parent else node.name if node else "未分類",
                    name=node.name if node else "未命名細項",
                    income=False,
                    amount=allocation.amount,
                    quantity=float(allocation.quantity)
                    if allocation.quantity is not None
                    else None,
                    unit=allocation.unit,
                    unit_price=allocation.unit_price,
                    note=allocation.note,
                    is_new=allocation.is_new,
                )
            )
        rows.extend(
            BudgetPlanRowOut(
                id=item.id,
                category=item.category,
                name=item.name,
                income=True,
                amount=item.amount,
                quantity=float(item.quantity) if item.quantity is not None else None,
                unit=item.unit,
                unit_price=item.unit_price,
                note=item.note,
                is_new=item.is_new,
            )
            for item in income_items
            if item.submission_id in submission_ids
        )
        return rows

    def project(
        self,
        allocations: Sequence[FinanceBudgetAllocation],
        nodes: Sequence[FinanceBudgetNode],
        income_items: Sequence[FinanceBudgetIncomeItem],
        expenses: Sequence[dict],
    ) -> BudgetPlanOut:
        rows = self._rows(self.submission_ids, allocations, nodes, income_items)
        changes: dict[tuple[str, str, bool], BudgetVersionChangeOut] = {}
        if len(self._approved) > 1:
            before = self._rows(
                self._effective_ids(self._approved[:-1]), allocations, nodes, income_items
            )
            for side, selected in (("before", before), ("after", rows)):
                for row in selected:
                    key = (row.category, row.name, row.income)
                    change = changes.setdefault(
                        key,
                        BudgetVersionChangeOut(
                            name=f"{row.category}／{row.name}（{'收入' if row.income else '支出'}）",
                            before=0,
                            after=0,
                        ),
                    )
                    if side == "before":
                        change.before += row.amount
                    else:
                        change.after += row.amount

        allocation_by_id = {allocation.id: allocation for allocation in allocations}
        historical = {}
        for expense in expenses:
            allocation = allocation_by_id.get(expense["allocation_id"])
            if (
                allocation is not None
                and allocation.submission_id not in self.submission_ids
                and self.permits_expense(allocation, original_allocation_id=allocation.id)
            ):
                historical[expense["id"]] = allocation.id
        return BudgetPlanOut(
            submission_ids=[item.id for item in self._approved if item.id in self.submission_ids],
            allocation_ids=[row.id for row in rows if not row.income],
            historical_expense_allocations=historical,
            rows=rows,
            changes=[change for change in changes.values() if change.before != change.after],
        )
